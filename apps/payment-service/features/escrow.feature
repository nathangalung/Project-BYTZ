Feature: Escrow Management

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

  # Escrow is funded by Midtrans telling us a payment settled, never by a
  # caller asserting an amount. The route that let a client do the latter is
  # gone: it wrote the full ledger pair with no gateway involvement, so an
  # owner could mint balance and then release real payouts against it.
  Scenario: Escrow can only be funded by a settled payment
    Given an owner with project "proj-1"
    When they try to create an escrow of 10000000 directly
    Then the request should be rejected

  Scenario: Release escrow to talent
    Given an escrow of 10000000 for project "proj-1"
    When the escrow is released with amount 8000000
    Then the talent should receive 8000000
    And the escrow balance should decrease

  Scenario: Refund cannot exceed the escrow funded for the project
    Given a transaction of 10000000
    And 8000000 has already been refunded
    When a refund of 5000000 is requested
    Then it should fail with "total refund exceeds escrow funded"
