// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { sealedImages } from "../../../lanes/eng-planted/e1/rebuild.ts";

describe("the rebuild pins the base image to the sealed digest", () => {
  const pinned = { "golang:1.24": "golang@sha256:new", "node:22": "node@sha256:n" };
  test("a pin whose image name matches the sealed FROM moves to the sealed digest; others stay", () => {
    expect(sealedImages(pinned, "# syntax=docker/dockerfile:1\n# Generated\nFROM golang@sha256:old\nRUN x\n")).toEqual({ "golang:1.24": "golang@sha256:old", "node:22": "node@sha256:n" });
  });
  test("a sealed Dockerfile with no digest in FROM leaves the pins as they are", () => {
    expect(sealedImages(pinned, "FROM scratch\n")).toEqual(pinned);
  });
});
