import { makeExecutableSchema } from "@graphql-tools/schema";
import { PrismaClient } from "@prisma/client";
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { expressMiddleware } from "@apollo/server/express4";
import express from "express";
import { PubSub } from "graphql-subscriptions";
import { useServer } from "graphql-ws/lib/use/ws";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { getToken } from "next-auth/jwt"; // ✅ Use getToken instead of getSession
import resolvers from "./graphql/resolvers";
import typeDefs from "./graphql/typeDefs";
import { GraphQLContext, Session, SubscriptionContext } from "./util/types";
import * as dotenv from "dotenv";
import cors from "cors";
import { json } from "body-parser";
import cookieParser from "cookie-parser"; 

dotenv.config();

// Initialize Prisma and PubSub
const prisma = new PrismaClient();
const pubsub = new PubSub();

const main = async () => {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  // Create Express app and HTTP server
  const app = express();
  const httpServer = createServer(app);

  // Set up WebSocket server
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql/subscriptions",
  });

  // Extract session for WebSockets
  const getSubscriptionContext = async (
    ctx: SubscriptionContext
  ): Promise<GraphQLContext> => {
    if (ctx.connectionParams && ctx.connectionParams.session) {
      return { session: ctx.connectionParams.session, prisma, pubsub };
    }
    return { session: null, prisma, pubsub };
  };

  // Setup WebSocket server
  const serverCleanup = useServer(
    {
      schema,
      context: (ctx: SubscriptionContext) => getSubscriptionContext(ctx),
    },
    wsServer
  );

  // Initialize Apollo Server
  const server = new ApolloServer({
    schema,
    csrfPrevention: true,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await server.start();

  // 🔹 Fixed CORS to allow credentials
  const corsOptions = {
    origin: "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "apollo-require-preflight"],
  };

  app.use(cors(corsOptions));
  app.use(json());
  app.use(cookieParser())

  // 🔹 Extract session from JWT Token instead of getSession()
  app.use(
    "/graphql",
    expressMiddleware(server, {
      context: async ({ req }): Promise<GraphQLContext> => {
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        return { session: token as Session, prisma, pubsub };
      },
    })
  );

  const PORT = 4000;
  await new Promise<void>((resolve) => httpServer.listen({ port: PORT }, resolve));
  console.log(`🚀 Server is running on http://localhost:${PORT}/graphql`);
};

main().catch((err) => console.error("❌ Server error:", err));
