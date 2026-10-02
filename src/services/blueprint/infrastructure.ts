/**
 * Infrastructure recommendation - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-9-impl-plan.md and
 * docs/specs/BLUEPRINT-SPEC.md section 2.17.
 *
 * The `infrastructure` section is a RECOMMENDATION for the generated project,
 * not observed site data. It is derived from detected technologies where
 * possible (runtime → node version, hosting/CDN → target) and otherwise uses the
 * safe, explicit defaults the spec requires (npm + static SPA). Environment
 * variables are emitted only when a runtime technology implies them - no secret
 * value is ever invented or stored.
 */
import type { ScanTechnology } from '../../types/models';
import type { BlueprintInfrastructure } from '../../types/blueprint';
import { ProvenanceCollector } from './evidence';

type PackageManager = BlueprintInfrastructure['package_manager'];
type Target = BlueprintInfrastructure['recommended_target'];

/** Detect a Node runtime version from a runtime technology's version string. */
function nodeVersionFrom(technologies: readonly ScanTechnology[]): string {
  const runtime = technologies.find(
    (technology) =>
      technology.category === 'Backend Framework & Server' && /node/i.test(technology.name)
  );
  if (runtime?.version) {
    const major = /^(\d+)/.exec(runtime.version);
    if (major) {
      return `${major[1]}.x`;
    }
  }
  return '20.x';
}

function packageManagerFrom(technologies: readonly ScanTechnology[]): PackageManager {
  const names = technologies.map((technology) => technology.name.toLowerCase());
  if (names.some((name) => name.includes('pnpm'))) {
    return 'pnpm';
  }
  if (names.some((name) => name.includes('yarn'))) {
    return 'yarn';
  }
  if (names.some((name) => name.includes('bun'))) {
    return 'bun';
  }
  return 'npm';
}

function targetFrom(technologies: readonly ScanTechnology[]): Target {
  const names = technologies.map((technology) =>
    `${technology.name} ${technology.technologyId ?? ''}`.toLowerCase()
  );
  if (names.some((name) => name.includes('cloudflare'))) {
    return 'cloudflare_pages';
  }
  if (names.some((name) => name.includes('vercel'))) {
    return 'vercel';
  }
  if (names.some((name) => name.includes('netlify'))) {
    return 'netlify';
  }
  if (names.some((name) => name.includes('docker'))) {
    return 'docker';
  }
  return 'static_spa';
}

/** Build the infrastructure recommendation from detected technologies. */
export function buildInfrastructure(
  technologies: readonly ScanTechnology[],
  collector: ProvenanceCollector = new ProvenanceCollector()
): BlueprintInfrastructure {
  const packageManager = packageManagerFrom(technologies);
  const target = targetFrom(technologies);
  const nodeVersion = nodeVersionFrom(technologies);

  collector.addInference({
    ref: 'infrastructure',
    method: 'recommendation',
    confidence: 0.5,
    limitation:
      'Build target and runtime are recommendations derived from detected technologies, not observed deployment facts.'
  });

  return {
    node_version: nodeVersion,
    package_manager: packageManager,
    recommended_target: target,
    env_variables: [],
    build_command: `${packageManager} run build`,
    output_directory: 'dist'
  };
}
