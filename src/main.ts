import { lambdaHandler } from "./index.js";
import { getAppClient, streamTweets, Tweet } from "./utils.js";
import { BOT_USER } from "./constants.js";

const callback = async (tweet: Tweet) => {
  lambdaHandler({ tweet: tweet }, null);
};

(async () => {
  console.log("Streaming...");
  streamTweets(
    getAppClient(),
    {
      "tweet.fields": [
        "author_id",
        "referenced_tweets",
        "in_reply_to_user_id",
        "id",
        "conversation_id"
      ],
      "user.fields": ["username"]
    },
    [
      {
        value: `${BOT_USER.handle} is:reply -from:${BOT_USER.user}`,
        tag: `mentions from ${BOT_USER.user} in replies and not from ${BOT_USER.user} itself`,
      },
    ],
    callback
  );
})();
