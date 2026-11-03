# Business-level plan flaw taxonomy

This taxonomy covers product and business decisions made before engineering starts. It excludes engineering correctness, security, APIs, developer experience, visual design and interaction design.

A finding needs a concrete conflict between a plan decision and evidence in the context folder. A missing paragraph or an unfamiliar choice is not enough. Read the whole context, including explicit exceptions, and classify a flaw by the decision that needs to change. One plan can contain several distinct flaws.

## Group W: builds the wrong thing

These flaws survive perfect execution. Fixing them requires changing the intended audience, problem, solution, value offered or business trade-off.

### W1. Wrong audience

**Definition.** The plan serves a user or buyer group that does not match the opportunity established in the context. Its features may work well for that group, but that group's needs, authority or willingness to participate cannot produce the required business outcome.

**How it shows up.** The plan chooses a segment, purchasing actor or beneficiary whose behavior does not support its stated goal. It may treat enthusiastic users as buyers even though someone else controls the purchase.

**Detectable evidence.** Segment-level retention or revenue data, research labeled by role, and purchasing notes establish which group has the need and the authority to act. The plan targets a different group, with no supported route from that choice to the goal.

**Example.** DeskNest builds paid personal desk reservations for employees, although its research says only office managers can buy or allocate desks.

**Not this.** A free employee tool is a justified entry point when documented pilots show employee use brings office managers into paid contracts.

**Nearest neighbour.** W2 chooses the wrong problem for the intended audience. W1 chooses the wrong audience even if it solves that audience's problem well.

### W2. Wrong problem

**Definition.** The plan addresses a real but low-value need while leaving the documented reason users fail, leave or refuse to buy untouched. Solving the selected problem would not materially improve the outcome the plan is meant to change.

**How it shows up.** A plan turns a frequent minor request into the main investment while the context identifies a different barrier. It assumes that because users asked for something, that thing deserves priority.

**Detectable evidence.** Research ranks problems by consequence, or support and churn records connect losses to specific unmet needs. Those records show that the selected problem is not the binding obstacle, and no explicit objective makes it the right priority.

**Example.** ShiftHarbor adds printable rota themes to reduce cancellations, while departing restaurants consistently cite an inability to fill vacant shifts.

**Not this.** Printable rotas are the right priority when a signed district contract requires them and the current objective is to deliver that contract, not reduce general churn.

**Nearest neighbour.** W3 targets the important problem but selects a solution that cannot address its cause. W2 selects the wrong problem before the solution is considered.

### W3. Solution misses the cause

**Definition.** The audience and problem are right, but the proposed product change does not affect the cause established in the context. Even full use of the feature would leave the obstacle in place.

**How it shows up.** The plan assumes that more information, reminders, automation or choice will change an outcome, while known facts show the barrier lies elsewhere. Its stated chain from feature use to business benefit contradicts those facts.

**Detectable evidence.** Interviews, process observations or prior experiments identify the actual cause and rule out the plan's assumed cause. General doubt is insufficient; the folder must establish why this particular solution cannot do the job.

**Example.** ParcelLane sends more delivery reminders to reduce failed handoffs, although recipients miss deliveries because the building desk closes before couriers arrive.

**Not this.** Reminders are justified when delivery records show that recipients can accept parcels but repeatedly forget booked arrival times.

**Nearest neighbour.** B1 concerns a material causal assumption that remains untested. W3 requires evidence that the proposed mechanism is wrong, not merely uncertain.

### W4. No added value

**Definition.** The plan builds a capability whose intended benefit users can already obtain through an available, suitable option. It offers no context-supported improvement in reach, cost, control or results that warrants a separate product investment.

**How it shows up.** The plan treats a capability as absent despite a working product, internal feature or established service already providing it. Its proposed replacement changes ownership or packaging without addressing a documented gap.

**Detectable evidence.** A product summary establishes the existing option's coverage, availability and cost, and usage records show that the intended users can use it. The plan's requirements add no needed capability or meaningful advantage.

**Example.** InvoiceCove proposes a second recurring-invoice product for its current customers, all of whom already have and use the same function in its standard subscription.

**Not this.** A separate product is justified when the existing function is available only through a costly suite and documented demand comes from customers who need nothing else in it.

**Nearest neighbour.** W3 fails to solve the problem. W4 can solve it perfectly, but duplicates a solution that already serves the same need.

### W5. Wrong trade-off

**Definition.** The plan gains one benefit by sacrificing something the business has explicitly decided to protect. The feature could succeed on its own terms, but its effect conflicts with a stated priority, constraint or obligation.

**How it shows up.** The plan optimizes local growth, revenue or convenience at the expense of a named company objective or an existing customer commitment. It treats that sacrifice as free, or makes a trade-off that the supplied priorities rule out.

**Detectable evidence.** The folder contains a ranked objective, a binding customer promise or an explicit constraint, plus facts connecting the proposed decision to a breach. A vague mission statement or the reviewer's personal preference is not enough.

**Example.** TutorPier opens discounted direct bookings with school-funded tutors, although its district agreements reserve those tutoring hours for enrolled pupils.

**Not this.** Direct bookings are justified when the agreements permit unused evening hours and the plan confines the offer to those hours.

**Nearest neighbour.** W6 asks whether the exchange can sustain itself economically. W5 can describe a profitable feature that still violates a protected business priority or obligation.

### W6. Unsustainable exchange

**Definition.** The proposed price, subsidy or participant reward makes the product's intended business model unable to sustain the target activity. The failure persists at the planned steady state, rather than arising only from a temporary launch cost or shortage of staff.

**How it shows up.** The plan charges less than unavoidable recurring costs without a funded reason, or asks an essential participant to accept a deal that documented behavior rules out. Its economics depend on a benefit or cross-subsidy the context shows is unavailable.

**Detectable evidence.** Known recurring costs, approved prices, purchase commitments or participant payout thresholds expose the mismatch. These facts must cover the intended operating range, not depend on invented market estimates.

**Example.** CallFern sells unlimited human interpretation for $12 per month, although its paid trial users average $70 in interpreter fees and no usage limit or subsidy is planned.

**Not this.** The same offer is a justified six-week experiment when the loss budget, participant limit, learning goal and end date are approved.

**Nearest neighbour.** B5 concerns commitments beyond available delivery or operating capacity. W6 concerns a value exchange that remains unsustainable even with adequate capacity and competent execution.

## Group B: builds the right thing badly

These flaws leave the intended customer benefit intact. Fixing them changes the size of the bet, scope, order, route to adoption, commitments or rules for expansion.

### B1. Commitment before learning

**Definition.** The plan makes a costly or hard-to-reverse commitment before resolving a pivotal uncertainty that a smaller, available test could resolve. The direction is plausible, but the evidence does not yet support the size or permanence of the bet.

**How it shows up.** The plan signs a long contract, retires an existing offer or funds a broad build before testing a named assumption about demand, payment or behavior. It defers the decisive learning until after the commitment.

**Detectable evidence.** Research explicitly marks the assumption as unresolved, and the folder documents a feasible smaller trial or existing route to test it. The commitment's cost, reversibility and timing make the exposure concrete.

**Example.** ClinicQuay commits to a year of staffed evening appointments before using its existing booking service to test whether patients will pay for evening slots.

**Not this.** A full-year commitment is justified when binding employer purchases already cover the year's costs and the remaining uncertainty would not change that decision.

**Nearest neighbour.** W3 has evidence that the solution misses the cause. B1 has an unresolved assumption and an unnecessarily large commitment before learning.

### B2. Unnecessary scope

**Definition.** The plan bundles work that is not needed for the agreed outcome into the required first delivery. That extra scope consumes scarce time or money and delays useful value without a supported business reason.

**How it shows up.** Optional segments, offer variants or adjacent capabilities become launch requirements. The plan gives the core outcome no independent delivery point even though the context shows it could stand alone.

**Detectable evidence.** User needs and acceptance conditions identify a smaller useful offer, while capacity estimates show that the additions materially delay it or displace a higher priority. The folder provides no contract, adoption need or economic dependency that requires the bundle.

**Example.** MenuMoor delays paid menu updates for cafes until it also supports hotel catering and stadium concession packages that no launch customer needs.

**Not this.** The bundle is justified when the first buyer operates all three settings and will purchase only a common service covering them.

**Nearest neighbour.** B3 includes necessary work in the wrong order. B2 includes work that need not be part of the initial commitment at all.

### B3. Prerequisites come too late

**Definition.** The plan pursues a valid benefit but schedules a necessary business condition after the activity that depends on it. The condition may be included in the plan, yet the ordering prevents the first release or launch from delivering its promised value.

**How it shows up.** Sales begin before an essential supplier agreement, a marketplace opens before adequate supply is secured, or customers are promised service before required business approval. These are business dependencies, not technical implementation dependencies.

**Detectable evidence.** Operating records, partner terms or process summaries establish the dependency and its lead time. The plan's sequence clearly puts the dependent commitment first without a workable interim arrangement.

**Example.** ToolBay sells weekend equipment rentals in a new town a month before its plan secures any local equipment owners.

**Not this.** Early sales are justified when a signed arrangement with a neighboring depot can fulfill every booking until local supply is ready.

**Nearest neighbour.** B4 lacks a workable route for intended users to adopt an available offer. B3 puts a known prerequisite too late, even if the eventual route to adoption is sound.

### B4. No workable path to adoption

**Definition.** The plan creates a useful offer but relies on an adoption route that the intended users or buyers cannot realistically follow. It does not bridge a documented barrier to discovering, purchasing or moving their work onto the offer.

**How it shows up.** The plan relies on a channel that cannot reach the target buyer, assumes users can authorize a purchase they cannot make, or expects a switch without the business support known to be necessary. This concerns distribution and organizational change, not screen layout or interaction details.

**Detectable evidence.** Channel results, purchasing procedures or prior onboarding records establish how these customers adopt products and which route has failed. The proposed launch uses that failed route or excludes the required assistance.

**Example.** LedgerHut launches a useful payroll service through employee referral emails, although its target firms buy payroll only through their contracted accounting advisers.

**Not this.** Employee referrals are justified when the accountants have agreed to receive, approve and fulfill those referrals through an existing partner program.

**Nearest neighbour.** W1 chooses the wrong people to serve. B4 serves the right people but gives them no workable route to become active customers.

### B5. Promises exceed capacity

**Definition.** The plan commits to dates, service levels or ongoing obligations beyond the people, funds or operating capacity available to fulfill them. The underlying offer can work, but the stated commitment cannot be kept at the planned scale.

**How it shows up.** A fixed launch date ignores known staffing limits, a service promise requires uncovered shifts, or a signed volume exceeds documented throughput. The plan treats a possible future hire or budget as already secured.

**Detectable evidence.** Staffing schedules, approved budgets, measured handling times and existing commitments establish the available capacity. Simple arithmetic shows the shortfall, with no funded reduction in demand or secured capacity increase.

**Example.** RepairReef promises two-hour human estimates around the clock, although its approved team covers only weekday business hours.

**Not this.** The promise is justified when a signed support-provider contract covers the remaining hours within the approved budget.

**Nearest neighbour.** W6 has a structurally unsustainable value exchange. B5 has a viable offer paired with excessive commitments; a smaller rollout, later date or funded capacity increase can fix it.

### B6. Expansion ignores outcomes

**Definition.** The plan expands or makes the offer permanent using a decision rule that does not establish whether it delivered the intended benefit. It can keep spending or exposing more customers even when the context's stated failure conditions have occurred.

**How it shows up.** Expansion happens automatically after launch, follows a metric already known to misrepresent success, or proceeds despite a breached business guardrail. The flaw is the planned decision rule, not the absence of a metrics section.

**Detectable evidence.** Goals define the desired result, historical metrics show the proposed signal's limitation, or an approved pilot brief states conditions for stopping. The plan's explicit expansion rule contradicts that evidence or those conditions.

**Example.** StockSprig rolls its replenishment service out nationally after 500 free signups, although past pilots reached that number while increasing customers' stockouts.

**Not this.** Signups are the right expansion gate when the approved goal is to test channel reach, downstream service quality is already established, and the next stage remains within the agreed exposure limit.

**Nearest neighbour.** B1 asks whether the initial commitment is too large before learning. B6 asks whether later commitments respond to the relevant outcomes once evidence is available.

