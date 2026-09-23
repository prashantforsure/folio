import { DOCUMENT_EXECUTORS } from '../document-ops'
import { registerExecutors } from '../executors'
import { registerTools, registeredTools } from '../registry'
import { CORE_TOOLS } from './core'
import { ENTITY_TOOLS } from './entities'
import { LAUNCHER_TOOLS } from './launcher'
import { RESEARCH_TOOLS } from './research'
import { SCRIPT_TOOLS } from './script'
import { TIMELINE_TOOLS } from './timeline'
import { ENTITY_WRITE_TOOLS } from './writes-entities'
import { TIMELINE_WRITE_TOOLS } from './writes-timeline'
import { executorsOf, toolsOf } from '../write-tool'

/**
 * Every tool, registered once - the rows of `docs/agents/tools.md`: Phase 2's
 * reads and client tools, and Phase 3's writes, which propose rather than
 * write (AGENTS.md ruling R8). Importing this
 * module is how a caller gets a populated registry; the guard makes a second
 * import (a test's, a hot reload's) a no-op rather than a "registered twice"
 * error. `tests/agent-tools.test.ts` checks the list against `tools.md`.
 */
if (registeredTools().length === 0) {
  registerTools([
    ...CORE_TOOLS,
    ...LAUNCHER_TOOLS,
    ...SCRIPT_TOOLS,
    ...ENTITY_TOOLS,
    ...TIMELINE_TOOLS,
    ...RESEARCH_TOOLS,
    // Phase 3: the writes, each beside its executor.
    ...toolsOf(ENTITY_WRITE_TOOLS),
    ...toolsOf(TIMELINE_WRITE_TOOLS),
  ])
}
// What applying each write means (roadmap Phase 3) - idempotent, so a second import is harmless.
registerExecutors([...DOCUMENT_EXECUTORS, ...executorsOf(ENTITY_WRITE_TOOLS), ...executorsOf(TIMELINE_WRITE_TOOLS)])

export { registeredTools }
