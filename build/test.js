import { Client, auth } from "twitter-api-sdk";
import { connectToRedisDatabase } from "./redis.js";
import * as dotenv from "dotenv";
import { JSDOM } from "jsdom";
import puppeteer from "puppeteer";
dotenv.config();
const BOT_USER = {
    handle: "@saveaclickbot",
    display_name: "saveaclickbot",
};
const extractUrls = (str, lower = false) => {
    const regexp = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?!&//=]*)/gi;
    if (typeof str !== "string") {
        throw new TypeError(`The str argument should be a string, got ${typeof str}`);
    }
    if (str) {
        let urls = str.match(regexp);
        if (urls) {
            return lower ? urls.map((item) => item.toLowerCase()) : urls;
        }
        else {
            undefined;
        }
    }
    else {
        undefined;
    }
};
const getTextNodes = (window, document, el) => {
    return walkNodeTree(window, document, el, {
        inspect: (n) => !["STYLE", "SCRIPT"].includes(n.nodeName),
        collect: (n) => n.nodeType === window.Node.TEXT_NODE,
    });
};
const walkNodeTree = (window, document, root, options) => {
    options = options || {};
    const inspect = options.inspect || ((n) => true), collect = options.collect || ((n) => true);
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_ALL, {
        acceptNode: function (node) {
            if (!inspect(node)) {
                return window.NodeFilter.FILTER_REJECT;
            }
            if (!collect(node)) {
                return window.NodeFilter.FILTER_SKIP;
            }
            return window.NodeFilter.FILTER_ACCEPT;
        },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
        options.callback && options.callback(n);
        nodes.push(n);
    }
    return nodes;
};
const getArticleDataUsingFetch = async (url) => {
    const text = await fetch(url).then((response) => response.text());
    const dom = new JSDOM(text);
    const { window } = dom;
    const { document } = window;
    const textNodes = getTextNodes(window, document, document.body);
    let bodyText = "";
    for (let textNode of textNodes) {
        bodyText += textNode.textContent;
    }
    return {
        title: document.getElementsByTagName("h1")[0].textContent,
        content: bodyText,
    };
};
const getArticleDataUsingPuppeteer = async (tweetUrl) => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    const response = await page.goto(tweetUrl.url);
    const text = await response.text();
    await browser.close();
    const dom = new JSDOM(text);
    const { window } = dom;
    const { document } = window;
    const textNodes = getTextNodes(window, document, document.body);
    let bodyText = "";
    for (let textNode of textNodes) {
        bodyText += textNode.textContent;
    }
    return {
        title: document.getElementsByTagName("h1")[0].textContent,
        content: bodyText,
    };
};
const authenticateAccount = async () => {
    const db = await connectToRedisDatabase({
        password: process.env.REDIS_SAC_PASSWORD,
        socket: {
            tls: true,
            host: process.env.REDIS_SAC_HOST,
            port: parseInt(process.env.REDIS_SAC_PORT),
        },
    });
    const token = JSON.parse((await db.get("token")));
    const authClient = new auth.OAuth2User({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        callback: process.env.CALLBACK_URL,
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
const getMentionsUsers = async (client, id) => {
    const mentions = await client.tweets.usersIdMentions(id, {
        "tweet.fields": [
            "author_id",
            "text",
            "in_reply_to_user_id",
            "referenced_tweets",
            "conversation_id",
        ],
    });
    const allMentionUsers = mentions.data;
    const tweetUrls = [];
    if (!allMentionUsers) {
        throw new Error("no mentions");
    }
    const mentionsUsers = [];
    for (let mention of allMentionUsers) {
        const originalTweet = await client.tweets.tweetsRecentSearch({
            query: `conversation_id:${mention.conversation_id}`,
            "tweet.fields": ["author_id", "in_reply_to_user_id"],
        });
        if (originalTweet.data.find((replyTweet) => replyTweet.author_id === id &&
            replyTweet.in_reply_to_user_id === mention.author_id) === undefined) {
            mentionsUsers.push(mention);
        }
    }
    return { mentionsUsers, tweetUrls };
};
const getParentTweet = async (client, tweet) => {
    if (!tweet.referenced_tweets) {
        throw new Error("no referenced tweets");
    }
    for (let referencedTweet of tweet.referenced_tweets) {
        if (referencedTweet.type === "replied_to") {
            return await client.tweets.findTweetById(referencedTweet.id);
        }
    }
    throw new Error("could not get replied to tweet");
};
const replyWithAnswer = async (client, tweet) => {
    const tweetWithUrl = await getParentTweet(client, tweet);
    const tweetText = tweet.text;
    const urls = extractUrls(tweetWithUrl.data.text) ?? [];
    const question = tweetText.substring(tweetText.lastIndexOf("@saveaclickbot") + "@saveaclickbot".length);
    console.log("Question", question);
    if (urls.length < 1) {
        throw new Error("no urls found");
    }
    console.log(`Getting article data for url ${urls[0]}...`);
    const articleData = await getArticleDataUsingFetch(urls[0]);
    console.log("Getting answer...");
    const result = await fetch("https://api-inference.huggingface.co/models/deepset/roberta-base-squad2", {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            inputs: {
                question: question || articleData.title,
                context: articleData.content,
            },
        }),
    }).then((response) => response.json());
    console.log("Answer:", result.answer);
    console.log("Replying to user...");
    await client.tweets.createTweet({
        text: result.answer.substring(0, 280),
        reply: {
            in_reply_to_tweet_id: tweet.id,
        },
    });
    console.log("Replied!");
};
const streamConnect = async (appClient, botClient) => {
    const stream = appClient.tweets.searchStream({
        "tweet.fields": ["referenced_tweets"],
    });
    for await (const tweet of stream) {
        console.log("Tweet!", tweet);
        replyWithAnswer(botClient, tweet.data).catch((error) => {
            console.log(error);
        });
    }
    return stream;
};
const main = async () => {
    console.log("Authenticating user...");
    const { authClient } = await authenticateAccount();
    const botClient = new Client(authClient);
    const appClient = new Client(process.env.BEARER_TOKEN);
    // const oldRules = await appClient.tweets.getRules()
    // console.log('Old rules:', oldRules)
    // if (oldRules.data) {
    //   await appClient.tweets.addOrDeleteRules({'delete': {ids: oldRules.data.map(oldRule => oldRule.id)}})
    // }
    // const newRules: components['schemas']['AddRulesRequest']['add'] = [{
    //   value: `${BOT_USER.handle} is:reply -from:${BOT_USER.display_name}`,
    //   tag: 'replies from users calling bot and not replies from the bot itself'
    // }]
    // try {
    //   await appClient.tweets.addOrDeleteRules({add: newRules});
    //   console.log(await appClient.tweets.getRules())
    // } catch (error) {
    //   console.error(error);
    // }
    console.log("Streaming...");
    streamConnect(appClient, botClient);
};
main();
