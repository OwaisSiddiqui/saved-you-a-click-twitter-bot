import { Client } from "twitter-api-sdk";
import { BOT_USER, CLICKBAIT_ARTICLES_TWITER_USERS } from "./constants.js";
import { getAnswer } from "./index.js";
import { streamTweets } from "./utils.js";
import {
  extractUrls,
  getAppClient,
  getBotClient,
  makeTweetCompatible,
  Tweet,
} from "./utils.js";
import { extract } from '@extractus/article-extractor'

const botClient = await getBotClient();

const botTweetReplyStandalone = async (client: Client, tweet: Tweet) => {
  const urls = extractUrls(tweet.text) ?? [];
  if (urls.length < 1) {
    throw new Error("no urls found");
  }

  // console.log(`Getting article data for url ${urls[0]}...`)
  const articleData = await extract(urls[0]);
  if (!articleData) {
    throw new Error('article data is null')
  }
  console.log('Article title:', articleData.title)
  const originalAnswer = await getAnswer(
    articleData.title,
    articleData.content
  );
  if (!(typeof originalAnswer === 'string')) {
    throw new Error('answer is not string')
  }
  
  // const answer = makeTweetCompatible(originalAnswer);

  // const replyTweetResponse = client.tweets.createTweet({
  //   text: answer,
  //   reply: {
  //     in_reply_to_tweet_id: tweet.id,
  //   },
  // });

  // const quoteTweetResponse = client.tweets.createTweet({
  //   text: answer,
  //   quote_tweet_id: tweet.id
  // });

  // await Promise.all([replyTweetResponse, quoteTweetResponse])
};

const callback = async (tweet: Tweet) => {
    botTweetReplyStandalone(botClient, tweet).catch((error) => {
      // console.log("Stream tweet:", error);
    });
};

(async () => {
  console.log('Streaming...')
  streamTweets(
    getAppClient(),
    {
      "tweet.fields": [
        "author_id",
        "referenced_tweets",
        "in_reply_to_user_id",
        "id",
        "conversation_id",
        "organic_metrics",
        "public_metrics",
        "non_public_metrics"
      ],
      "user.fields": [
        "name",
        "username",
        "location"
      ],
      "media.fields": [
        "type",
        "url"
      ]
    },
    [
      {
        value: `followers_count:50000 tweets_count:500 -from:${BOT_USER.user} -is:retweet -is:quote is:verified lang:en -is:nullcast has:links -has:video_link`,
        tag: `tweets with links and not from ${BOT_USER.user}`,
      },
    ],
    callback
  );
})();
