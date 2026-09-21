import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket")
        return new Response("websocket only", { status: 426 });
      const code = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) return new Response("bad room", { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req);
    }
    return new Response("not found", { status: 404 });
  },
};

export class Room extends DurableObject {
  async fetch(req) {
    const socks = this.ctx.getWebSockets();
    if (socks.length >= 2) return new Response("room full", { status: 409 });
    const used = socks.map((ws) => ws.deserializeAttachment()?.slot);
    const slot = used.includes(0) ? 1 : 0;           // 먼저 온 사람 = P1(방장)
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);                 // 절전 가능한 방식으로 연결 수락
    server.serializeAttachment({ slot });
    server.send(JSON.stringify({ t: "hello", slot }));
    if (socks.length === 1) {                          // 두 번째 사람 입장 → 시작
      const seed = (Math.random() * 2 ** 31) | 0;
      for (const ws of this.ctx.getWebSockets())
        ws.send(JSON.stringify({ t: "start", seed }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, msg) {                          // 받은 입력을 상대에게 그대로 전달
    for (const o of this.ctx.getWebSockets()) if (o !== ws) o.send(msg);
  }
  webSocketClose(ws) {
    for (const o of this.ctx.getWebSockets())
      if (o !== ws) try { o.send(JSON.stringify({ t: "leave" })); } catch {}
    try { ws.close(1000, "bye"); } catch {}
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}
