Feature: Escrow Management

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

  Scenario: Midtrans webhook updates transaction
    Given a pending transaction with order "BRD-proj1-123"
    When Midtrans sends settlement webhook
    Then the transaction status should be "completed"
