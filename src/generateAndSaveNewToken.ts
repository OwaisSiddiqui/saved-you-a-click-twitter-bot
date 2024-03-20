import { Client, auth } from "twitter-api-sdk";
import { connectToRedisDatabase } from "./redis.js";
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const authClient = new auth.OAuth2User({
  client_id: process.env.CLIENT_ID as string,
  client_secret: process.env.CLIENT_SECRET as string,
  callback: process.env.CALLBACK_URL as string,
  scopes: ["tweet.write", "tweet.read", "users.read", "offline.access"],
});

const client = new Client(authClient);

const STATE = "my-state";

app.get("/callback", async function (req, res) {
  try {
    const { code, state } = req.query;
    console.log('Code:', code)
    const db = await connectToRedisDatabase({password: process.env.REDIS_SAC_PASSWORD as string,
      socket: {
        tls: true,
        host: process.env.REDIS_SAC_HOST as string,
        port: parseInt(process.env.REDIS_SAC_PORT as string),
      },})
    if (state !== STATE) return res.status(500).send("State isn't matching");
    if (!(typeof code === 'string')) {
      throw new Error('code is not string')
    }
    await db.set('token', JSON.stringify((await authClient.requestAccessToken(code)).token))
    // server.close();
  } catch (error) {
    console.log(error);
  }
});

app.get("/revoke", async function (req, res) {
  try {
    const response = await authClient.revokeAccessToken();
    res.send(response);
  } catch (error) {
    console.log(error);
  }
});

app.get("/login", async function (req, res) {
  const authUrl = authClient.generateAuthURL({
    state: STATE,
    code_challenge_method: "s256",
  });
  res.redirect(authUrl);
});

const server = app.listen(3000, () => {
  console.log(`Go here to login: http://127.0.0.1:3000/login`);
});
