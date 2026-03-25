Feature: Milestone Management

  Scenario: Milestone pending to in_progress
    Given a milestone in "pending" status
    When status changed to "in_progress"
    Then the transition should succeed

  Scenario: Owner approves submitted milestone
    Given a milestone in "submitted" status
    When status changed to "approved"
    Then the transition should succeed

  Scenario: Cannot skip to approved from pending
    Given a milestone in "pending" status
    When status changed to "approved"
    Then the transition should fail

  Scenario: Revision limit enforced at 2
    Given a milestone with 2 revisions
    When a revision is requested
    Then it should fail with revision limit

  Scenario: Free revision within limit
    Given a milestone with 0 revisions used
    When a revision is requested
    Then the revision should be accepted
    And the revision count should be 1

  Scenario: Free revision at limit boundary
    Given a milestone with 1 revision used
    When a revision is requested
    Then the revision should be accepted
    And the revision count should be 2

  Scenario: Talent cannot approve milestones
    Given a milestone in "submitted" status
    When a talent tries to approve it
    Then it should be rejected with "AUTH_FORBIDDEN"
