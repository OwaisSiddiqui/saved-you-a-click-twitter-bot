import { JSDOM, DOMWindow } from "jsdom";
import { Client } from "twitter-api-sdk";
import { components, searchStream } from "twitter-api-sdk/dist/types.js";
import { authenticateAccount } from "./index.js";
import util from 'util'

interface ArticleData {
  title: string;
  content: string;
}

export type Tweet = components["schemas"]["Tweet"];

export const extractUrls = (str: string, lower = false) => {
  const regexp =
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?!&//=]*)/gi;

  if (typeof str !== "string") {
    throw new TypeError(
      `The str argument should be a string, got ${typeof str}`
    );
  }

  if (str) {
    let urls = str.match(regexp);
    if (urls) {
      return lower ? urls.map((item) => item.toLowerCase()) : urls;
    } else {
      undefined;
    }
  } else {
    undefined;
  }
};

const getTextNodes = (window: DOMWindow, document: Document, el) => {
  return walkNodeTree(window, document, el, {
    inspect: (n) => !["STYLE", "SCRIPT"].includes(n.nodeName),
    collect: (n) => n.nodeType === window.Node.TEXT_NODE,
  });
};

const walkNodeTree = (window: DOMWindow, document: Document, root, options) => {
  options = options || {};

  const inspect = options.inspect || ((n) => true),
    collect = options.collect || ((n) => true);
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

export const getArticleDataUsingFetch = async (
  url: string
): Promise<ArticleData> => {
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

export const getAppClient = () => {
  return new Client(process.env.BEARER_TOKEN as string);
};

export const getBotClient = async () => {
  return new Client((await authenticateAccount()).authClient);
};

export const makeTweetCompatible = (text: string) => {
  return text.trim().substring(0, 280);
};

export const streamTweets = async (
  client: Client,
  searchStreamsParams: searchStream["parameters"]["query"],
  rules: components["schemas"]["AddRulesRequest"]["add"],
  callback: (tweet: Tweet) => Promise<void>
) => {
  const oldRules = (await client.tweets.getRules()).data;
  console.log('Old rules:', oldRules)
  if (oldRules) {
    const ids = oldRules.map((oldRule) => oldRule.id)
    await client.tweets.addOrDeleteRules({
      delete: { ids: ids},
    });
  }
  console.log('New rules:', rules)
  await client.tweets.addOrDeleteRules({ add: rules });

  const stream = client.tweets.searchStream(searchStreamsParams);

  console.log('Streaming...')
  for await (const response of stream) {
    // console.log('🟢 Response', response)
    const tweet = response.data;
    if (tweet) {
      // console.log("🐦 Tweet!", util.inspect(tweet, true, null, true))
      callback(tweet);
    }
  }
};
