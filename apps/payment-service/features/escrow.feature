Feature: Escrow Management

  Scenario: Create escrow validates amount
    Given an escrow request with amount 0
    When the escrow is created
    Then it should fail with validation error

  Scenario: Release escrow validates amount
    Given a release request with amount 0
    When the release is processed
    Then it should fail with validation error

  Scenario: Refund validates amount
    Given a refund request with amount 0
    When the refund is processed
    Then it should fail with validation error

  Scenario: Midtrans webhook processes settlement
    Given a pending transaction
    When Midtrans sends settlement status
    Then transaction should be completed

  Scenario: Create escrow for a project
    Given an owner with project "proj-1"
    When they create an escrow of 10000000
    Then a pending escrow transaction should exist
    And the escrow account balance should be 10000000

  Scenario: Release escrow to talent
    Given an escrow of 10000000 for project "proj-1"
    When the escrow is released with amount 8000000
    Then the talent should receive 8000000
    And the escrow balance should decrease

  Scenario: Refund cannot exceed original amount
    Given a transaction of 10000000
    And 8000000 has already been refunded
    When a refund of 5000000 is requested
    Then it should fail with "total refund exceeds original"
