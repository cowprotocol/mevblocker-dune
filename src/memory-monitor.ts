import log from "./log";

export class MemoryMonitor {
  private static instance: MemoryMonitor;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private memoryThresholdMB = 512; // Alert if memory usage exceeds 512MB

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  public startMonitoring(intervalMs = 30000): void {
    if (this.monitoringInterval) {
      return; // Already monitoring
    }

    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, intervalMs);

    log.debug("Memory monitoring started");
  }

  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      log.debug("Memory monitoring stopped");
    }
  }

  public getMemoryStats() {
    const usage = process.memoryUsage();
    return {
      rss: Math.round(usage.rss / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024), // MB
    };
  }

  public logMemoryStats(): void {
    const stats = this.getMemoryStats();
    log.debug(
      `Memory usage: RSS=${stats.rss}MB, Heap=${stats.heapUsed}/${stats.heapTotal}MB, External=${stats.external}MB`
    );
  }

  public forceGarbageCollection(): void {
    if (global.gc) {
      const beforeStats = this.getMemoryStats();
      global.gc();
      const afterStats = this.getMemoryStats();
      log.debug(
        `Forced GC: heap ${beforeStats.heapUsed}MB -> ${
          afterStats.heapUsed
        }MB (freed ${beforeStats.heapUsed - afterStats.heapUsed}MB)`
      );
    } else {
      log.warn(
        "Garbage collection not exposed. Start Node.js with --expose-gc flag"
      );
    }
  }

  private checkMemoryUsage(): void {
    const stats = this.getMemoryStats();

    if (stats.heapUsed > this.memoryThresholdMB) {
      log.warn(
        `High memory usage detected: ${stats.heapUsed}MB heap used (threshold: ${this.memoryThresholdMB}MB)`
      );

      // Auto-trigger GC if available and memory is very high
      if (stats.heapUsed > this.memoryThresholdMB * 1.5 && global.gc) {
        log.info("Triggering garbage collection due to high memory usage");
        this.forceGarbageCollection();
      }
    }
  }

  public setMemoryThreshold(thresholdMB: number): void {
    this.memoryThresholdMB = thresholdMB;
    log.debug(`Memory threshold set to ${thresholdMB}MB`);
  }
}

export default MemoryMonitor.getInstance();
