import { createClient } from "redis";

interface ConnectToRedisDatabaseParameters {
  password: string;
  socket: {
    tls: boolean;
    host: string;
    port: number;
  };
}

export async function connectToRedisDatabase({
  password,
  socket,
}: ConnectToRedisDatabaseParameters) {
  const redisDb = createClient({
    password: password,
    socket: socket,
  });

  redisDb.on("error", (error) => {
    console.log("Redis Error:", error);
  });

  await redisDb.connect();

  return redisDb;
}
