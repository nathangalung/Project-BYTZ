Feature: Admin Management

  Scenario: Suspend a user
    Given an admin user
    When they suspend user "user-1" with reason "Inactive"
    Then the user should be suspended

  Scenario: View dashboard stats
    Given an authenticated admin
    When they request dashboard data
    Then project stats should be returned
    And revenue stats should be returned

  Scenario: List users returns paginated results
    Given an authenticated admin with users
    When they request the users list
    Then users should be returned with pagination

  Scenario: Unsuspend a user
    Given an admin user with a suspended user "user-2"
    When they unsuspend user "user-2"
    Then the user should be unsuspended
