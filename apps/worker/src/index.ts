/**
 * worker — BullMQ consumers. Long-running, never a serverless function.
 *
 * Deliberately empty. No queue, no Redis connection, no BullMQ dependency yet;
 * those arrive with the first job, along with this app's build step.
 */
export const APP_NAME = 'worker'
