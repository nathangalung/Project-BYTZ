from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "ai-service"


class ChatMessage(BaseModel):
    role: str = Field(description="Role: system, user, or assistant")
    content: str = Field(description="Message content")


class ChatRequest(BaseModel):
    project_id: str
    messages: list[ChatMessage]
    model: str = "chatbot"


class ChatResponse(BaseModel):
    message: ChatMessage
    completeness_score: int = Field(ge=0, le=100)
    suggest_generate_brd: bool = False


class BrdSection(BaseModel):
    title: str
    content: str


class BrdDocument(BaseModel):
    executive_summary: str
    business_objectives: list[str]
    success_metrics: list[str]
    scope: str
    out_of_scope: list[str]
    functional_requirements: list[BrdSection]
    non_functional_requirements: list[str]
    estimated_price_min: int
    estimated_price_max: int
    estimated_timeline_days: int
    estimated_team_size: int
    risk_assessment: list[str]


class GenerateBrdRequest(BaseModel):
    project_id: str
    conversation_history: list[ChatMessage]
    project_category: str
    budget_min: int | None = None
    budget_max: int | None = None
    timeline_days: int | None = None


class GenerateBrdResponse(BaseModel):
    brd: BrdDocument
    tokens_used: int
    model: str


class CvParseRequest(BaseModel):
    worker_id: str
    file_url: str
    file_type: str = "pdf"


class CvParsedData(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    education: list[dict] = []
    experience: list[dict] = []
    projects: list[dict] = []
    skills: list[str] = []
    certifications: list[dict] = []


class CvParseResponse(BaseModel):
    worker_id: str
    parsed_data: CvParsedData
    confidence_score: float


class MatchingRequest(BaseModel):
    project_id: str
    required_skills: list[str]
    budget: int | None = None
    timeline_days: int | None = None


class WorkerScore(BaseModel):
    worker_id: str
    score: float
    skill_match: float
    pemerataan_score: float
    track_record: float
    rating: float
    is_exploration: bool = False


class MatchingResponse(BaseModel):
    project_id: str
    recommendations: list[WorkerScore]
    exploration_count: int
    exploitation_count: int
