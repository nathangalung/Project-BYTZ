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
