Feature: Project Lifecycle

  Scenario: Create project with valid data
    Given a valid project creation payload
    When the project is created
    Then it should have status "draft"

  Scenario: Transition draft to scoping
    Given a project in "draft" status
    When transitioned to "scoping"
    Then the transition should succeed

  Scenario: Transition from scoping to brd_review
    Given a project in "scoping" status
    When transitioned to "brd_review"
    Then the transition should succeed

  Scenario: Invalid transition rejected
    Given a project in "draft" status
    When transitioned to "completed"
    Then the transition should fail

  Scenario: Cannot skip from draft to in_progress
    Given a project in "draft" status
    When transitioned to "in_progress"
    Then the transition should fail

  Scenario: A team project cannot skip past the work
    Given a project with team_size 3 in "matching" status
    When transitioned to "final_review"
    Then the transition should fail

  Scenario: A team project starts work from matching
    Given a project with team_size 3 in "matching" status
    When transitioned to "in_progress"
    Then the transition should succeed

  Scenario: Cancelled project cannot transition
    Given a project in "cancelled" status
    When transitioned to "scoping"
    Then the transition should fail

  Scenario: Resolving a dispute is not a project transition
    Given a project in "disputed" status
    When transitioned to "in_progress"
    Then the transition should fail
