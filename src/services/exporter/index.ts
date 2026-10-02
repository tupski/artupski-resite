/**
 * Project documentation & export engine - public surface - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-14-impl-plan.md sections 7, 9.
 *
 * Consumers import from here; the internal modules stay private. The pure
 * documentation generator, the dependency-free deterministic ZIP codec, and the
 * orchestrating export service are all re-exported for callers and tests.
 */
export { generateDocs } from './docGenerator';

export {
  buildZip,
  readZip,
  crc32,
  ZipError,
  ZIP_LOCAL_FILE_HEADER_SIGNATURE,
  ZIP_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_VERSION_NEEDED,
  ZIP_VERSION_MADE_BY,
  ZIP_FLAG_UTF8,
  ZIP_DOS_TIME_MIDNIGHT,
  ZIP_DOS_DATE_1980_01_01,
  ZIP_METHOD_STORE,
  ZIP_METHOD_DEFLATE,
  type ZipArchive
} from './zip';

export {
  exportProject,
  createNodeExportIo,
  type ExportFileReader,
  type ExportFileWriter,
  type ExportProjectDeps
} from './zipExporter';

export {
  MAX_EXPORT_ENTRIES,
  MAX_EXPORT_ENTRY_BYTES,
  MAX_EXPORT_TOTAL_BYTES,
  MAX_EXPORT_PATH_DEPTH,
  MAX_EXPORT_DOC_BYTES,
  type GeneratedDocName,
  type DocGenerationInput,
  type GeneratedDoc,
  type DocGenerationResult,
  type ExportMode,
  type ZipCompressionMethod,
  type ExportOptions,
  type ExportProjectRequest,
  type ExportFailure,
  type ExportSummary,
  type ExportProjectReport,
  type ZipEntryMeta
} from '../../types/export';
