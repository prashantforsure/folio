import type { Route } from 'next'

/**
 * The two routes that are named from more than one place.
 *
 * This file was the home sidebar's table - New · Recents · Screenwriting ·
 * Filmmaking, with Trash reached from the project list header and account
 * settings from the avatar menu. The account routes pass (2026-09-22) made
 * the sidebar four different rows (`home-nav.ts`) with Trash and Settings
 * among them, and the three list routes became one; what is left here are the
 * two paths the workspace rail's avatar menu and the home nav both name, kept
 * in one place so they cannot drift apart.
 */

/** Reached from the workspace rail's avatar menu and from the home sidebar. */
export const ACCOUNT_SETTINGS: Route = '/app/settings'

/** A sidebar row since 2026-09-22, and still linked from the Projects toolbar. */
export const TRASH: Route = '/app/trash'
