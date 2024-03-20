import { createClient } from "redis";
export async function connectToRedisDatabase({ password, socket, }) {
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
