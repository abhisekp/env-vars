const dotenv = require('dotenv')
const mongoose = require("mongoose")
const datefns = require('date-fns');
const {Octokit} = require("@octokit/rest");
const delay = require('delay')
const pMap = require('p-map');
const {toPairs} = require('lodash/fp')
const parseLinkHeader = require('parse-link-header');
const {createTokenAuth} = require("@octokit/auth-token");
const url = require('url');
const fetch = require('isomorphic-fetch')

dotenv.config();

const uri = process.env.MONGODB_URI;

const EnvSchema = new mongoose.Schema(
  {
    deleted: Boolean,
    deletedAt: Date,
    frequency: {
      type: Number,
      default: 1
    },
    name: {
      type: String,
      required: true
    },
    value: {
      type: String,
    },
    url: String,
    htmlUrl: String
  },
  {
    timestamps: true,
    toJSON: {
      virtual: true,
      getters: true
    },
    toObject: {
      virtual: true,
      getters: true
    }
  });

EnvSchema.index({
  name: 1,
  value: 1
}, {unique: true})

const EnvModel = mongoose.model('Env', EnvSchema, 'github');

async function connectMongo() {
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
      useFindAndModify: false,
    })
  } catch (err) {
    console.error(err);
  }
}

function parseEnvs(text) {
  return dotenv.parse(text)
}

const genRawUrl = ({sha, path, fullname}) => url.format(new url.URL(`https://raw.githubusercontent.com/${fullname}/${sha}/${path}`), {unicode: true})

async function startHarvest() {
  const auth = createTokenAuth(process.env.GITHUB_ACCESS_TOKEN);
  const {token} = await auth();
  const octokit = new Octokit({
    version: "3.0.0",
    timeZone: 'Asia/Kolkata',
    auth: token
  });

  for (let done = false, nextPage = 1, lastPage = 1; nextPage <= lastPage && !done;) {
    const {data, headers} = await octokit.search.code({
      q: 'env extension:env size:<100',
      per_page: 100,
      page: nextPage
    });

    console.log({headers});

    const limit = +headers['x-ratelimit-limit'];
    const remaining = +headers['x-ratelimit-limit'];
    const resetTime = +headers['x-ratelimit-reset'];
    // x-ratelimit-limit: "30"
    // x-ratelimit-remaining: "29"
    // x-ratelimit-reset: "1593629668"

    const link = parseLinkHeader(headers.link)
    nextPage = link.next ? +link.next.page : undefined;
    lastPage = link.last ? +link.last.page : undefined;
    isIncomplete = data.incomplete_results;

    console.log(data, link);
    console.log(data.items)

    try {
      await pMap(data.items, async (item) => {
        try {
          const refUrl = url.parse(item.url, true);
          // console.log(refUrl);
          const rawUrl = genRawUrl({fullname: item.repository.full_name, sha: refUrl.query.ref, path: item.path});
          console.log({rawUrl, htmlUrl: item.html_url})
          const rawUrlResponse = await fetch(rawUrl);
          console.log({rawUrlHeaders: rawUrlResponse.headers.raw()});
          const text = await rawUrlResponse.text()

          const envs = parseEnvs(text)
          console.log(envs);
          await pMap(toPairs(envs), async ([name, value]) => {
            try {
              await EnvModel.findOneAndUpdate({
                name,
                value,
              }, {
                $inc: {
                  frequency: 1
                },
                url: rawUrl,
                htmlUrl: item.html_url
              }, {
                upsert: true,
                new: true
              })
            } catch (err) {
              if (![11000].includes(err.code)) {
                throw err;
              }
            }
          }, {concurrency: 150 /* saving to db */})
        } catch (e) {
          if ([403, 429].includes(e.code)) {
            throw e;
          }
          console.error(e);
        }
      }, {concurrency: 30 /* fetching raw text */, stopOnError: false})
    } catch (e) {
      if ([403, 429].includes(e.code)) {
        throw e;
      }
      console.error(e);
    }

    // done = true;
    /* fetching urls */
    if (remaining < 2) {
      const delayTime = datefns.differenceInMilliseconds(new Date(resetTime), Date.now())
      await delay(delayTime);
    }
  }
}


;(async function start() {
  try {
    await connectMongo();
    await startHarvest();
    console.log('Done havesting all envs from github');
  } catch (error) {
    console.error('There was an error havesting envs from github');
    console.error(error);
  } finally {
    await mongoose.connection.close();
  }

})()
