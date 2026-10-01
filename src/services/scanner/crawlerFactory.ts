/**
 * Crawler service factory - Artupski ReSite
 *
 * Wires the orchestration service to the real storage repositories and the
 * typed worker client. Kept separate from `crawlerService.ts` so the service
 * itself stays free of singletons and is trivially unit-testable with fakes.
 *
 * The browser session is launched by the caller (the browser runtime / a later
 * UI workstream); this factory only adapts the repositories + worker client.
 */
import { storageService } from '../storage';
import type {
  CreateScanInput,
  UpdateScanProgressInput,
  UpdateScanStatusInput,
  UpsertScanPageInput,
  UpsertScanTechnologyInput
} from '../storage';
import { ScannerWorkerClient } from './scannerWorkerClient';
import { CrawlerService, type CrawlPersistence, type CrawlWorker, type CrawlerServiceDeps } from './crawlerService';
import type { Scan } from '../../types/models';

/** Persistence adapter over the live storage repositories. */
export function createStorageCrawlPersistence(): CrawlPersistence {
  return {
    async createScan(input: CreateScanInput): Promise<Scan> {
      return storageService.getRepositories().scans.create(input);
    },
    async updateStatus(id: string, input: UpdateScanStatusInput): Promise<Scan | null> {
      return storageService.getRepositories().scans.updateStatus(id, input);
    },
    async updateProgress(id: string, input: UpdateScanProgressInput): Promise<Scan | null> {
      return storageService.getRepositories().scans.updateProgress(id, input);
    },
    async findActive(): Promise<Scan[]> {
      return storageService.getRepositories().scans.findActive();
    },
    async upsertPages(inputs: UpsertScanPageInput[]): Promise<number> {
      return storageService.getRepositories().pages.upsertMany(inputs);
    },
    async countPages(scanId: string): Promise<number> {
      return storageService.getRepositories().pages.countByScan(scanId);
    },
    async upsertTechnologies(inputs: UpsertScanTechnologyInput[]): Promise<number> {
      return storageService.getRepositories().technologies.upsertMany(inputs);
    }
  };
}

/** The `ScannerWorkerClient` satisfies the `CrawlWorker` port structurally. */
export function createCrawlerService(deps: {
  worker: ScannerWorkerClient;
  persistence?: CrawlPersistence;
  events?: CrawlerServiceDeps['events'];
  logger?: CrawlerServiceDeps['logger'];
  idFactory?: () => string;
}): CrawlerService {
  return new CrawlerService({
    persistence: deps.persistence ?? createStorageCrawlPersistence(),
    worker: deps.worker as unknown as CrawlWorker,
    events: deps.events,
    logger: deps.logger,
    idFactory: deps.idFactory
  });
}
