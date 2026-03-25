Feature: User Authentication

  Scenario: Owner registration with valid data
    Given a valid owner registration payload
    When the registration schema is validated
    Then validation should pass
    And the role should be "owner"

  Scenario: Talent registration with valid data
    Given a valid talent registration payload
    When the registration schema is validated
    Then validation should pass
    And the role should be "talent"

  Scenario: Admin registration is blocked
    Given a registration payload with role "admin"
    When the registration schema is validated
    Then validation should fail

  Scenario: Invalid phone format rejected
    Given a registration payload with phone "12345"
    When the phone schema is validated
    Then validation should fail

  Scenario: Valid Indonesian phone accepted
    Given a registration payload with phone "+6281234567890"
    When the phone schema is validated
    Then validation should pass

  Scenario: OTP code must be 6 digits
    Given an OTP code "12345"
    When the OTP schema is validated
    Then validation should fail

  Scenario: Valid OTP code accepted
    Given an OTP code "123456"
    When the OTP schema is validated
    Then validation should pass

  Scenario: Password change requires minimum length
    Given a new password "short"
    When the password is checked
    Then it should be rejected for being too short

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
