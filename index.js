const { GraphQLClient } = require("graphql-request");
const fs = require("fs");
const argv = require("minimist")(process.argv.slice(2));
const fileName = argv.filename || "results";
const csv = require("csv-writer").createObjectCsvWriter;

// Add as many tokens as needed, considering the amount of data
const tokens = [
  "PERSONAL_ACCESS_TOKEN_1",
  "PERSONAL_ACCESS_TOKEN_2",
  "PERSONAL_ACCESS_TOKEN_3",
  "PERSONAL_ACCESS_TOKEN_..."
];
let tokenIndex = 0;

// Rotate through the available tokens and prevent rate limits or other restrictions that may be imposed on a single token.
function getNextToken() {
  const token = tokens[tokenIndex];
  tokenIndex = (tokenIndex + 1) % tokens.length;
  return token;
}

const batchSize = 50; // Set the desired batch size. Maximum is 100

// Fecth a batch of results based on the provided search query, current date, cursor (pagination), and previous results. 
async function fetchResultsBatch(searchQuery, currentDate, cursor = null, results = []) {
  try {
    const client = new GraphQLClient("https://api.github.com/graphql", {
      headers: {
        Authorization: `Bearer ${getNextToken()}`
      }
    });

    const data = await client.request(query, {
      searchQuery,
      first: batchSize,
      after: cursor
    });

    const { nodes, pageInfo } = data.search;
    results.push(...nodes);
    if (currentDate!==undefined){
    console.log(`\nExtracted ${results.length} results for ${currentDate}...`);
    }else{
    console.log(`\nExtracted ${results.length} results so far...`);
    }

    const rateLimitData = await client.request(rateLimitQuery);
    const rateLimit = rateLimitData.rateLimit;
    console.log("Rate Limit:", rateLimit);
    console.log("hasNextPage:", pageInfo.hasNextPage);
    console.log("endCursor:", pageInfo.endCursor);

    if (pageInfo.hasNextPage) {
      // Delay between batches to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Adjust the delay time as needed
      return fetchResultsBatch(searchQuery, currentDate, pageInfo.endCursor, results);
    } else {
      return results;
    }
  } catch (error) {
    console.error(error);
  }
}

// Determine whether to fetch all results in a single batch or in multiple batches based on total results and dates.
async function fetchAllResults() {
  try {
    const client = new GraphQLClient("https://api.github.com/graphql", {
      headers: {
        Authorization: `Bearer ${getNextToken()}`
      }
    });

    const data = await client.request(countQuery, { completeSearchQuery });
    const { repositoryCount } = data.search;
    console.log(`Total results: ${repositoryCount}`);

    if (repositoryCount <= 1000) {
      return fetchResultsBatch(completeSearchQuery);
    } else {
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);
      const dayInMilliseconds = 24 * 60 * 60 * 1000;
      const dayCount = Math.ceil((endDateObj - startDateObj) / dayInMilliseconds);
//    console.log(dayCount);
      let results = [];

      for (let i = 0; i < dayCount+1; i++) {
        const currentDate = new Date(startDateObj.getTime() + i * dayInMilliseconds).toISOString().split("T")[0];
        const currentSearchQuery = `${searchQuery} ${dateType}:${currentDate}`;

        const result = await fetchResultsBatch(currentSearchQuery, currentDate);
        results.push(...result);
      }

      return results;
    }
  } catch (error) {
    console.error(error);
  }
}

// Write formatted data in JSON and CSV files
function writeFiles(json) {
  const formattedResults = json.map((result) => {
    // Modify according to the desired format and extraction fields
    const data = {
      name: result.nameWithOwner.split("/")[1],
      owner: result.nameWithOwner.split("/")[0],
      description: result.description ? result.description : "",
      url: result.url,
      createdAt: result.createdAt.split("T")[0],
      users: result.assignableUsers.totalCount,
      watchers: result.watchers.totalCount,
      stars: result.stargazerCount,
      forks: result.forkCount,
      projects: result.projects.totalCount,
      issues: result.issues.totalCount,
      pullRequests: result.pullRequests.totalCount,
      diskUsage: result.diskUsage,
      license: result.licenseInfo ? result.licenseInfo.spdxId : "",
      languages: result.languages.edges.map((edge) => edge.node.name),
      primaryLanguage: result.primaryLanguage ? result.primaryLanguage.name : "",
      environments: result.environments.edges.map((edge) => edge.node.name),
      submodules: result.submodules.edges.map((edge) => edge.node.name),
      topics: result.repositoryTopics.edges.map((edge) => edge.node.topic.name),
    };

    // Check if the dictionary file exists
  if (fs.existsSync("dictionary.json")) {
    // Read the dictionary file
    const dictionary = require("./dictionary.json");
     // Check if any tag from the dictionary is present in the name or description
     const nameAndDescTags = dictionary.filter((currentTag) => {
        return (
          (data.name && data.name.toLowerCase().includes(currentTag.tag)) ||
         (data.description && data.description.toLowerCase().includes(currentTag.tag))
        );
     });

      // Check if the tags are already in the topics field, and if not, add them to the 'extra' column
     const extraTags = nameAndDescTags.filter((currentTag) => {
       return !data.topics.includes(currentTag.tag);
     });

     data.extra = extraTags.map((currentTag) => currentTag.tag);
   }

    return data;
  });

  // Save as JSON
  fs.writeFile(`${fileName}.json`, JSON.stringify(formattedResults, null, 2), function (err) {
    if (err) throw err;
    console.log(`${fileName}.json file saved`);
  });

  // Save as CSV
  const csvWriter = csv({
    path: `${fileName}.csv`,
    header: Object.keys(formattedResults[0]).map((key) => ({ id: key, title: key })),
  });

  csvWriter
    .writeRecords(formattedResults)
    .then(() => console.log(`${fileName}.csv file saved`))
    .catch((err) => console.error(err));
}


// Write JSON file without any format or dictionary
// function writeJsonFile(json) {
//   fs.writeFile(`${fileName}.json`, JSON.stringify(json, null, 2), function (err) {
//     if (err) throw err;
//     console.log(`${fileName} file saved`);
//   });
// }

// Set query, count its totals and check rate limits
const query = `query ($searchQuery: String!, $first: Int, $after: String) {
  search(query: $searchQuery, type: REPOSITORY, first: $first, after: $after) {
    nodes {
      ... on Repository {
        nameWithOwner
        description
        url
        createdAt
        assignableUsers {
          totalCount
        }
        watchers {
          totalCount
        }
        stargazerCount
        forkCount
        projects {
          totalCount
        }
        issues {
          totalCount
        }
        pullRequests {
          totalCount
        }
        diskUsage
        licenseInfo {
          spdxId
        }
        languages(first: 5) {
          edges {
            node {
              name
            }
          }
        }
        primaryLanguage {
          name
        }
        environments(first: 5) {
          edges {
            node {
              name
            }
          }
        }
        submodules(first: 5) {
          edges {
            node {
              name
            }
          }
        }
        repositoryTopics(first: 5) {
          edges {
            node {
              topic {
                name
              }
            }
          }
        }
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}`;

const countQuery = `query ($completeSearchQuery: String!) {
  search(query: $completeSearchQuery, type: REPOSITORY, first: 1) {
    repositoryCount
  }
}`;

const rateLimitQuery = `query {
  rateLimit {
    limit
    cost
    remaining
    used
    resetAt
    nodeCount
  }
}`;

// Create arguments and set defaults
const now = new Date().toISOString().split("T")[0];
const searchQuery = argv.query || "mobile AND (android OR ios)";
const startDate = argv.start || "2013-01-01";
const endDate = argv.end || now;
const dateType= argv.date || "created"; 

// Construct the search query with the date range
const completeSearchQuery = `${searchQuery} ${dateType}:${startDate}..${endDate}`;
console.log("Search Query:", completeSearchQuery);

// Run and write the extracted data to a JSON file
fetchAllResults()
  .then((data) => {
    writeFiles(data);
    //writeJsonFile(data);
    console.log(`Fetched ${data.length} results.`);
  })
  .catch((error) => console.error(error));
