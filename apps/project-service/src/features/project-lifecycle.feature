Feature: Project Lifecycle

  Scenario: Create project with valid data
    Given a valid project creation payload
    When the project is created
    Then it should have status "draft"

  Scenario: Transition draft to scoping
    Given a project in "draft" status
    When transitioned to "scoping"
    Then the transition should succeed

  Scenario: Transition from scoping to brd_generated
    Given a project in "scoping" status
    When transitioned to "brd_generated"
    Then the transition should succeed

  Scenario: Invalid transition rejected
    Given a project in "draft" status
    When transitioned to "completed"
    Then the transition should fail

  Scenario: Cannot skip from draft to in_progress
    Given a project in "draft" status
    When transitioned to "in_progress"
    Then the transition should fail

  Scenario: Team project must go through team_forming
    Given a project with team_size 3 in "matching" status
    When transitioned to "matched"
    Then the transition should fail

  Scenario: Team project can enter team_forming
    Given a project with team_size 3 in "matching" status
    When transitioned to "team_forming"
    Then the transition should succeed

  Scenario: Cancelled project cannot transition
    Given a project in "cancelled" status
    When transitioned to "scoping"
    Then the transition should fail

  Scenario: Dispute can be resolved to continue
    Given a project in "disputed" status
    When transitioned to "in_progress"
    Then the transition should succeed
