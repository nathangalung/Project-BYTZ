Feature: Milestone Management

  Scenario: Owner approves a submitted milestone
    Given a milestone in "submitted" status
    When the owner approves it
    Then the milestone status should be "approved"

  Scenario: Talent cannot approve milestones
    Given a milestone in "submitted" status
    When a talent tries to approve it
    Then it should be rejected with "AUTH_FORBIDDEN"

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

  Scenario: Free revision limit enforced
    Given a milestone with 2 revisions already
    When a revision is requested
    Then it should be rejected as revision limit exceeded

  Scenario: Cannot approve a pending milestone
    Given a milestone in "pending" status
    When the owner approves it
    Then the milestone transition should be rejected
