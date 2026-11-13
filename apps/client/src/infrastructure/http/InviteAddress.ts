const loopbackHost = /^(localhost|\[::1\]|127(?:\.\d{1,3}){3})$/;

export function localNetworkOrigin(value:unknown):string|null{
  if(typeof value!=="string")return null;
  try{
    const url=new URL(value);
    const host=url.hostname;
    const octets=host.split(".");
    const ipv4=octets.length===4&&octets.every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255);
    const local=loopbackHost.test(host)||ipv4&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    return url.protocol==="http:"&&local&&!url.username&&!url.password?url.origin:null;
  }catch{return null;}
}

/** A browser opened on localhost needs the host PC's LAN address to invite another device. */
export class InviteAddress {
  private readonly initialOrigin: string | null;
  private readonly needsLookup: boolean;
  private readonly request: typeof fetch;
  private origin: string | null;
  private pending: Promise<void> | undefined;

  // The Windows launcher imports this module with Node's type-stripping mode.
  constructor(initialOrigin: string, request: typeof fetch = (input, init) => fetch(input, init)) {
    this.request = request;
    this.initialOrigin = localNetworkOrigin(initialOrigin);
    this.origin = this.initialOrigin;
    this.needsLookup = this.origin !== null && loopbackHost.test(new URL(this.origin).hostname);
  }

  refresh(): Promise<void> {
    // An address that already reached the host is better than guessing among network adapters.
    if (!this.needsLookup) return Promise.resolve();
    if (!this.pending) this.pending = this.load().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async load() {
    try {
      const response = await this.request("/api/lan-origin", { signal: AbortSignal.timeout(2500), cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      this.origin = localNetworkOrigin(data.origin) ?? this.initialOrigin;
    } catch { /* Keep the current address during a transient lookup failure. */ }
  }

  url(roomId: string) {
    if (!this.origin) return "";
    const url = new URL("/", this.origin);
    url.searchParams.set("room", roomId);
    return url.toString();
  }
}
