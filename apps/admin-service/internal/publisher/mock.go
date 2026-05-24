package publisher

import "context"

// MockPublisher records Republish calls for unit tests.
type MockPublisher struct {
	RepublishFn func(ctx context.Context, originalEventID, eventType string, payload, traceContext []byte) error
	Calls       []MockCall
}

// MockCall captures the args of a single Republish invocation.
type MockCall struct {
	OriginalEventID string
	EventType       string
	Payload         []byte
	TraceContext    []byte
}

func (m *MockPublisher) Republish(ctx context.Context, originalEventID, eventType string, payload, traceContext []byte) error {
	m.Calls = append(m.Calls, MockCall{
		OriginalEventID: originalEventID,
		EventType:       eventType,
		Payload:         payload,
		TraceContext:    traceContext,
	})
	if m.RepublishFn != nil {
		return m.RepublishFn(ctx, originalEventID, eventType, payload, traceContext)
	}
	return nil
}

func (m *MockPublisher) Close() {}
