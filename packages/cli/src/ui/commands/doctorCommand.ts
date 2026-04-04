import type { SlashCommand, MessageActionReturn } from './types.js';
import { CommandKind } from './types.js';
import {
  getAllMCPServerStatuses,
  getMCPDiscoveryState,
  MCPServerStatus,
  MCPDiscoveryState,
} from '@qwen-code/qwen-code-core';
import { getSystemInfo } from '../../utils/systemInfo.js';
import { t } from '../../i18n/index.js';

interface CheckResult {
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
}

function formatCheck(check: CheckResult): string {
  const icon =
    check.status === 'pass'
      ? '[PASS]'
      : check.status === 'warn'
        ? '[WARN]'
        : '[FAIL]';
  const line = `  ${icon} ${check.label}`;
  return check.detail ? `${line}\n       ${check.detail}` : line;
}

export const doctorCommand: SlashCommand = {
  name: 'doctor',
  altNames: ['health'],
  get description() {
    return t('Run system health checks');
  },
  kind: CommandKind.BUILT_IN,
  action: async (context): Promise<MessageActionReturn> => {
    const checks: CheckResult[] = [];
    const config = context.services.config;

    // --- System ---
    const sysInfo = await getSystemInfo(context);

    // Node.js version
    const nodeVersion = process.versions.node;
    const nodeMajor = parseInt(nodeVersion.split('.')[0]!, 10);
    checks.push(
      nodeMajor >= 18
        ? { label: `Node.js ${nodeVersion}`, status: 'pass' }
        : {
            label: `Node.js ${nodeVersion}`,
            status: 'warn',
            detail: 'Node.js 18+ recommended',
          },
    );

    // --- Authentication ---
    const authType = sysInfo.selectedAuthType;
    checks.push(
      authType
        ? { label: `Auth: ${authType}`, status: 'pass' }
        : {
            label: 'Auth: not configured',
            status: 'fail',
            detail: 'Run /auth to configure authentication',
          },
    );

    // --- Model ---
    const model = sysInfo.modelVersion;
    checks.push(
      model && model !== 'Unknown'
        ? { label: `Model: ${model}`, status: 'pass' }
        : {
            label: 'Model: not set',
            status: 'warn',
            detail: 'Run /model to select a model',
          },
    );

    // --- MCP Servers ---
    const mcpDiscovery = getMCPDiscoveryState();
    const mcpStatuses = getAllMCPServerStatuses();
    const mcpServers = config?.getMcpServers() ?? {};
    const configuredServerNames = Object.keys(mcpServers);

    if (configuredServerNames.length === 0) {
      checks.push({
        label: 'MCP servers: none configured',
        status: 'pass',
        detail: "No MCP servers in config (this is fine if you don't need any)",
      });
    } else {
      if (mcpDiscovery !== MCPDiscoveryState.COMPLETED) {
        checks.push({
          label: `MCP discovery: ${mcpDiscovery}`,
          status: 'warn',
          detail: 'MCP server discovery has not completed yet',
        });
      }

      for (const name of configuredServerNames) {
        const status = mcpStatuses.get(name) ?? MCPServerStatus.DISCONNECTED;
        if (status === MCPServerStatus.CONNECTED) {
          checks.push({ label: `MCP "${name}": connected`, status: 'pass' });
        } else if (status === MCPServerStatus.CONNECTING) {
          checks.push({
            label: `MCP "${name}": connecting`,
            status: 'warn',
            detail: 'Server is still connecting',
          });
        } else {
          checks.push({
            label: `MCP "${name}": disconnected`,
            status: 'fail',
            detail: 'Server failed to connect. Check config with /mcp',
          });
        }
      }
    }

    // --- Extensions ---
    const extensions = config?.getExtensions() ?? [];
    if (extensions.length === 0) {
      checks.push({
        label: 'Extensions: none installed',
        status: 'pass',
      });
    } else {
      const active = extensions.filter((e) => e.isActive);
      const inactive = extensions.filter((e) => !e.isActive);
      checks.push({
        label: `Extensions: ${active.length} active, ${inactive.length} inactive`,
        status: 'pass',
      });
      for (const ext of inactive) {
        checks.push({
          label: `Extension "${ext.name}": disabled`,
          status: 'warn',
          detail: 'Enable with /extensions manage',
        });
      }
    }

    // --- Git ---
    const git = context.services.git;
    if (git) {
      checks.push({ label: 'Git: available', status: 'pass' });
    } else {
      checks.push({
        label: 'Git: not available',
        status: 'warn',
        detail: 'Some features require git',
      });
    }

    // --- Environment ---
    const sandbox = sysInfo.sandboxEnv;
    if (sandbox !== 'no sandbox') {
      checks.push({ label: `Sandbox: ${sandbox}`, status: 'pass' });
    }

    if (sysInfo.proxy) {
      checks.push({
        label: `Proxy: ${sysInfo.proxy}`,
        status: 'pass',
      });
    }

    // --- Summary ---
    const passes = checks.filter((c) => c.status === 'pass').length;
    const warns = checks.filter((c) => c.status === 'warn').length;
    const fails = checks.filter((c) => c.status === 'fail').length;

    const lines = [
      `Qwen Code Doctor (v${sysInfo.cliVersion})`,
      '',
      ...checks.map(formatCheck),
      '',
      `${passes} passed, ${warns} warnings, ${fails} failures`,
    ];

    return {
      type: 'message',
      messageType: fails > 0 ? 'error' : 'info',
      content: lines.join('\n'),
    };
  },
};
