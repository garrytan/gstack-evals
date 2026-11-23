# Copyright (c) 2026 Garry Tan. MIT License.
"""In-container decision-routing agent: mini-swe-agent's DefaultAgent with five code-level decision points.

state builds the decision state, rules_parser holds the frozen test-runner rule, counting the arm-neutral action
counter and allowance mapping, deciders the Jev and generative adapters, routed the defer rule and the routed agent,
natural the N agent and its calibration shadow logger, log the decision log, session the entry point and shadow the
host-side shadow answering.
"""
