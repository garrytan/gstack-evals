// Copyright (c) 2026 Garry Tan. MIT License.
// GitHub reads for the product-value eval's free mining (prereg section 4 and section 18's outside terms): the GraphQL
// and REST APIs through the authenticated gh CLI, paced, with the GraphQL points each job used logged to its run log.
// The org's GraphQL quota is shared, so a job reads rate_limit before and after and waits for the reset rather than
// running the quota low. A thin binding of the shared client (lanes/aftermath/gh.ts) to product-value's floor and its
// four tries with a 20-second backoff step.
import { openGitHub } from "../../aftermath/gh.ts";

export { GhError } from "../../aftermath/gh.ts";

/** Never let this job take the shared GraphQL quota under FLOOR; wait for the reset instead. */
export const FLOOR = 2500;

const gh = openGitHub({ floor: FLOOR, tries: 4, backoffMs: (attempt) => attempt * 20_000, paceMs: 0 });

/** The GraphQL quota left, read from REST rate_limit (free). */
export const graphqlLeft = () => gh.graphqlLeft();
export const pointsUsed = () => gh.pointsUsed();
export const graphql = <T = any>(query: string, variables: Record<string, unknown> = {}): T => gh.graphql<T>(query, variables);
export const rest = <T = any>(path: string): T => gh.rest<T>(path);
/** REST that may 404: null instead of an error. */
export const restMaybe = <T = any>(path: string): T | null => gh.restMaybe<T>(path);
