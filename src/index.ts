import * as dotenv from "dotenv";
import { Context } from "aws-lambda";
import { Client, auth } from "twitter-api-sdk";
import { connectToRedisDatabase } from "./redis.js";
import { components } from "twitter-api-sdk/dist/gen/openapi-types.js";
import {
  extractUrls,
  getArticleDataUsingFetch,
  getBotClient,
  makeTweetCompatible,
  Tweet,
} from "./utils.js";
import {
  BOT_USER,
  HUGGING_FACE_ROBERTA_QUESTION_ANSWER_API_URL,
} from "./constants.js";

dotenv.config();

export const authenticateAccount = async () => {
  const db = await connectToRedisDatabase({
    password: process.env.REDIS_SAC_PASSWORD as string,
    socket: {
      tls: true,
      host: process.env.REDIS_SAC_HOST as string,
      port: parseInt(process.env.REDIS_SAC_PORT as string),
    },
  });

  const token = JSON.parse((await db.get("token")) as string);

  const authClient = new auth.OAuth2User({
    client_id: process.env.CLIENT_ID as string,
    client_secret: process.env.CLIENT_SECRET as string,
    callback: process.env.CALLBACK_URL as string,
    scopes: ["tweet.write", "tweet.read", "users.read", "offline.access"],
    token: token,
  });

  if (authClient.isAccessTokenExpired()) {
    const result = await authClient.refreshAccessToken();
    await db.set("token", JSON.stringify(result.token));
  }

  await db.quit();

  return { authClient };
};

export const getAnswer = async (
  question: string,
  context: string
): Promise<unknown> => {
  return fetch(HUGGING_FACE_ROBERTA_QUESTION_ANSWER_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      inputs: {
        question: question,
        context: context,
      },
    }),
  })
    .then((response) => response.json())
    .then((data) => data.answer);
};

export const getParentTweet = async (
  client: Client,
  tweet: components["schemas"]["Tweet"]
): Promise<Tweet> => {
  if (!tweet.referenced_tweets) {
    throw new Error("no referenced tweets");
  }

  for (let referencedTweet of tweet.referenced_tweets) {
    if (referencedTweet.type === "replied_to") {
      const result = await client.tweets.findTweetById(referencedTweet.id);
      return result.data;
    }
  }

  throw new Error("could not get replied to tweet");
};

const replyWithAnswer = async (
  client: Client,
  tweet: components["schemas"]["Tweet"]
) => {
  const tweetWithUrl = await getParentTweet(client, tweet);

  const tweetText: string = tweet.text;
  const urls = extractUrls(tweetWithUrl.text) ?? [];

  const question = tweetText.substring(
    tweetText.lastIndexOf(BOT_USER.handle) + BOT_USER.handle.length
  );
  console.log("Question", question);

  if (urls.length < 1) {
    throw new Error("no urls found");
  }

  console.log(`Getting article data for url ${urls[0]}...`);
  const articleData = await getArticleDataUsingFetch(urls[0]);

  console.log("Getting answer...");
  const originalAnswer = await getAnswer(
    question || articleData.title,
    articleData.content
  );

  if (!(typeof originalAnswer === 'string')) {
    throw new Error('answer is not string')
  }

  const answer = makeTweetCompatible(originalAnswer);
  if (!answer) {
    throw new Error("answer was empty");
  }

  console.log("Replying to user...");
  try {
    await client.tweets.createTweet({
      text: answer,
      reply: {
        in_reply_to_tweet_id: tweet.id,
      },
    });
  } catch (error) {
    console.log("Replying with tweet:", error);
  }
  console.log("Replied!");
};

export const lambdaHandler = async (event: any, context: Context) => {
  const tweet = event.tweet;
  if (!tweet) {
    throw new Error("no tweet");
  }

  return replyWithAnswer(await getBotClient(), tweet);
};
