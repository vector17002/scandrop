//singleton class for rate limiter
class RateLimiter {
   public static instance: RateLimiter | null = null;
   public requests: Map<string | import("express").Request["ip"], { count: number; timestamp: number }> = new Map();
   private constructor(private limit: number, private interval: number) {
      this.limit = limit
      this.interval = interval
   }

   public static getInstance(limit: number, interval: number): RateLimiter {
       if (!RateLimiter.instance) {
           RateLimiter.instance = new RateLimiter(limit, interval);
       }
       return RateLimiter.instance;
   }

   public static resetInstance(): void {
       RateLimiter.instance = null;
   }

   public isAllowed(ip: string | import("express").Request["ip"]): boolean {
       const currentTime = Date.now();
       const requestInfo = this.requests.get(ip);

       if (!requestInfo) {
           this.requests.set(ip, { count: 1, timestamp: currentTime });
           return true;
       }

       if (currentTime - requestInfo.timestamp > this.interval) {
           this.requests.set(ip, { count: 1, timestamp: currentTime });
           return true;
       }

       if (requestInfo.count < this.limit) {
           this.requests.set(ip, { count: requestInfo.count + 1, timestamp: requestInfo.timestamp });
           return true;
       }

       return false;
   }
}

export default RateLimiter;