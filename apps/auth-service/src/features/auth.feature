Feature: User Authentication

  Scenario: Owner registers successfully
    Given a new user with email "test@example.com" and role "owner"
    When they submit the registration form
    Then the account should be created
    And the role should be "owner"

  Scenario: Talent registers successfully
    Given a new user with email "talent@example.com" and role "talent"
    When they submit the registration form
    Then the account should be created
    And the role should be "talent"

  Scenario: Admin registration is blocked
    Given a new user with email "admin@evil.com" and role "admin"
    When they submit the registration form
    Then the registration should be rejected
    And the error code should be "INVALID_ROLE"

  Scenario: Invalid phone format is rejected
    Given a new user with phone "12345"
    When they submit the registration form
    Then the registration should be rejected

  Scenario: Valid Indonesian phone is accepted
    Given a new user with phone "+6281234567890"
    When they submit the registration form
    Then the account should be created

  Scenario: OTP verification succeeds
    Given a user with a valid OTP code
    When they verify the OTP
    Then the phone should be marked as verified

  Scenario: Expired OTP is rejected
    Given a user with an expired OTP code
    When they verify the OTP
    Then the OTP verification should be rejected

  Scenario: OTP with too many attempts is rejected
    Given a user who exceeded OTP attempts
    When they verify the OTP
    Then the OTP verification should be rejected

  Scenario: Password change with wrong current password
    Given an authenticated user
    When they change password with wrong current password
    Then the change should be rejected with "AUTH_INVALID_PASSWORD"
