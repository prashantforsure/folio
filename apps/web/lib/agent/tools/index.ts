import { registerTools, registeredTools } from '../registry'
import { CORE_TOOLS } from './core'

/**
 * Every tool, registered once. Importing this module is how a caller gets a
 * populated registry; the guard makes a second import (a test's, a hot
 * reload's) a no-op rather than a "registered twice" error.
 */
if (registeredTools().length === 0) registerTools([...CORE_TOOLS])

export { registeredTools }
