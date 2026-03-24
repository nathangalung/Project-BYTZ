Feature: Project Lifecycle

  Scenario: Create a new project
    Given an owner wants to create a project
    When they submit title "E-commerce App" and category "web_app"
    Then the project should be created with status "draft"

  Scenario: Transition from draft to scoping
    Given a project in "draft" status
    When the owner transitions to "scoping"
    Then the status should be "scoping"

  Scenario: Transition from scoping to brd_generated
    Given a project in "scoping" status
    When the owner transitions to "brd_generated"
    Then the status should be "brd_generated"

  Scenario: Invalid transition is rejected
    Given a project in "draft" status
    When the owner transitions to "completed"
    Then the transition should be rejected

  Scenario: Cannot skip from draft to in_progress
    Given a project in "draft" status
    When the owner transitions to "in_progress"
    Then the transition should be rejected

  Scenario: Team project requires team_forming
    Given a project with team_size 3 in "matching" status
    When the system transitions to "team_forming"
    Then the status should be "team_forming"

  Scenario: Cancelled project is final
    Given a project in "cancelled" status
    When the owner transitions to "draft"
    Then the transition should be rejected

  Scenario: Dispute can be resolved to continue
    Given a project in "disputed" status
    When the admin resolves dispute to continue
    Then the status should be "in_progress"
