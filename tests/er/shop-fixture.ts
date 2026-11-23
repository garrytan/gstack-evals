// Copyright (c) 2026 Garry Tan. MIT License.
// A fixture repository for the eng-review authoring tests: an invented Kotlin shop app written with git fast-import, so
// every sha is the same on every machine. Nothing here is a real project.
import { join } from "node:path";
import type { RepoMeta } from "../../lanes/real-outcome/mine/meta.ts";
import { buildRepo, MIT, tempDir, type FxCommit } from "../real/fixture.ts";

export const CART_0 = "package shop\n\nclass Cart {\n    val items = mutableListOf<Int>()\n\n    fun total(): Int {\n        return items.sum()\n    }\n}\n";
export const CART_1 = CART_0.replace("        return items.sum()\n", "        val sum = items.sum()\n        return sum - Discount.off(sum)\n");
export const DISCOUNT_1 = "package shop\n\nobject Discount {\n    var code: String? = null\n\n    fun off(sum: Int): Int {\n        if (code == null) return 0\n        val pct = 10\n        return sum * pct / 100\n    }\n\n    fun valid(c: String): Boolean {\n        return c.length == 6\n    }\n}\n";
export const DISCOUNT_2 = DISCOUNT_1.replace("        return sum * pct / 100\n", "        return (sum * pct + 50) / 100\n");
const WISH = "package shop\n\nclass Wishlist {\n" + Array.from({ length: 45 }, (_, i) => "    fun item" + i + "() = " + i + "\n").join("") + "}\n";
const CI_0 = "name: ci\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./gradlew test\n";

export function shopCommits(): FxCommit[] {
  return [
    { name: "c0", message: "Start the shop app", date: "2026-05-01T10:00:00Z", files: { LICENSE: MIT, "README.md": "# Shop\n\nA phone app for small shops.\n", "app/src/main/kotlin/shop/Cart.kt": CART_0, "app/src/test/kotlin/shop/CartTest.kt": "class CartTest\n", ".github/workflows/ci.yml": CI_0 } },
    { name: "early", message: "Add order history (#5)", date: "2026-06-20T10:00:00Z", files: { "app/src/main/kotlin/shop/History.kt": WISH.replace("Wishlist", "History"), "app/src/main/kotlin/shop/HistoryView.kt": "class HistoryView\n" } },
    { name: "u1", message: "Add discount codes to the cart (#10)", date: "2026-07-10T10:00:00Z", files: { "app/src/main/kotlin/shop/Cart.kt": CART_1, "app/src/main/kotlin/shop/Discount.kt": DISCOUNT_1, "app/src/test/kotlin/shop/CartTest.kt": "class CartTest {\n    fun discounted() {}\n}\n" } },
    { name: "docs", message: "Update the README", date: "2026-07-12T10:00:00Z", files: { "README.md": "# Shop\n\nA phone app for small shops, with discounts.\n" } },
    { name: "small", message: "Show the cart count", date: "2026-07-14T10:00:00Z", files: { "app/src/main/kotlin/shop/Badge.kt": "class Badge\n" } },
    { name: "u5", message: "Add gift cards (#15)", date: "2026-07-15T10:00:00Z", files: { "app/src/main/kotlin/shop/Gift.kt": WISH.replace("Wishlist", "Gift"), "app/src/main/kotlin/shop/GiftView.kt": "class GiftView\n" } },
    { name: "u2", message: "Add a wishlist (#11)", date: "2026-07-20T10:00:00Z", files: { "app/src/main/kotlin/shop/Wishlist.kt": WISH } },
    { name: "rev", message: (s) => 'Revert "Add a wishlist (#11)"\n\nThis reverts commit ' + s.u2 + ". It broke checkout on small screens.", date: "2026-07-25T10:00:00Z", files: { "app/src/main/kotlin/shop/Wishlist.kt": null } },
    { name: "fix", message: "Fix discount rounding (#12)", date: "2026-08-01T10:00:00Z", files: { "app/src/main/kotlin/shop/Discount.kt": DISCOUNT_2 } },
    { name: "t", message: "Add tests for discount codes (#13)", date: "2026-08-10T10:00:00Z", files: { "app/src/test/kotlin/shop/DiscountTest.kt": "class DiscountTest {\n    fun sixLetters() {}\n}\n" } },
    { name: "c", message: "Run the shop tests on two API levels (#14)", date: "2026-08-15T10:00:00Z", files: { ".github/workflows/ci.yml": CI_0 + "    strategy:\n      matrix:\n        api: [24, 34]\n      # covers app/src/main/kotlin/shop discount paths\n" } },
    { name: "mcp", message: "Add an editor config", date: "2026-09-01T10:00:00Z", files: { ".mcp.json": "{}\n" } },
    { name: "u4", message: "feat: add store pickup (#16)", date: "2026-09-20T10:00:00Z", files: { "app/src/main/kotlin/shop/Pickup.kt": WISH.replace("Wishlist", "Pickup"), "app/src/main/kotlin/shop/PickupView.kt": "class PickupView\n" } },
  ];
}

const pr = (sha: Record<string, string>, name: string, number: number, title: string, created: string, merged: string, closing: number[] = []) => ({
  number, title, body: "", created_at: created, merged_at: merged, merge_commit: sha[name]!, labels: [], closing_issues: closing, commits: [{ sha: sha[name]!, authored_at: merged, committed_at: merged }],
});

export function shopMeta(sha: Record<string, string>): RepoMeta {
  return {
    repo: "fixture/shop",
    fetched_at: "2026-11-08T00:00:00Z",
    prs: [
      pr(sha, "early", 5, "Add order history", "2026-06-18T10:00:00Z", "2026-06-20T10:00:00Z"),
      pr(sha, "u1", 10, "Add discount codes to the cart", "2026-07-06T10:00:00Z", "2026-07-10T10:00:00Z", [9]),
      pr(sha, "u2", 11, "Add a wishlist", "2026-07-18T10:00:00Z", "2026-07-20T10:00:00Z"),
      pr(sha, "fix", 12, "Fix discount rounding", "2026-07-30T10:00:00Z", "2026-08-01T10:00:00Z", [20]),
      pr(sha, "t", 13, "Add tests for discount codes", "2026-08-09T10:00:00Z", "2026-08-10T10:00:00Z"),
      pr(sha, "c", 14, "Run the shop tests on two API levels", "2026-08-14T10:00:00Z", "2026-08-15T10:00:00Z"),
      pr(sha, "u5", 15, "Add gift cards", "2026-06-25T10:00:00Z", "2026-07-15T10:00:00Z"),
      pr(sha, "u4", 16, "feat: add store pickup", "2026-09-18T10:00:00Z", "2026-09-20T10:00:00Z"),
    ],
    issues: [
      { number: 9, title: "Shops want discount codes", created_at: "2026-07-05T10:00:00Z", labels: [] },
      { number: 20, title: "Discount total is off by one", created_at: "2026-07-29T10:00:00Z", labels: ["bug"] },
    ],
  };
}

export function buildShop(): { dir: string; sha: Record<string, string>; meta: RepoMeta; cleanup: () => void } {
  const t = tempDir("er-shop-");
  const dir = join(t.dir, "shop");
  const sha = buildRepo(dir, shopCommits());
  return { dir, sha, meta: shopMeta(sha), cleanup: t.cleanup };
}
