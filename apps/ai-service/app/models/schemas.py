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
    talent_id: str
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
    portfolio_urls: list[str] = []


class CvParseResponse(BaseModel):
    talent_id: str
    parsed_data: CvParsedData
    confidence_score: float
    raw_text: str = ""


class WorkPackageSpec(BaseModel):
    title: str
    description: str = ""
    required_skills: list[str] = []
    estimated_hours: float = 0
    amount: int = 0


class DependencySpec(BaseModel):
    from_package: str
    to_package: str
    type: str = "finish_to_start"


class TeamComposition(BaseModel):
    team_size: int = 1
    work_packages: list[WorkPackageSpec] = []


class SprintPlan(BaseModel):
    sprint_number: int
    title: str
    tasks: list[str] = []
    duration_days: int = 14


class PrdDocument(BaseModel):
    tech_stack: list[str] = []
    architecture: str = ""
    api_design: str = ""
    database_schema: str = ""
    team_composition: TeamComposition = TeamComposition()
    work_packages: list[WorkPackageSpec] = []
    sprint_plan: list[SprintPlan] = []
    dependencies: list[DependencySpec] = []
    estimated_price_min: int = 0
    estimated_price_max: int = 0
    estimated_timeline_days: int = 0
    estimated_team_size: int = 1


class GeneratePrdRequest(BaseModel):
    project_id: str
    conversation_history: list[ChatMessage] = []
    brd_content: dict = {}
    project_category: str = "web_app"
    budget_min: int | None = None
    budget_max: int | None = None
    timeline_days: int | None = None


class GeneratePrdResponse(BaseModel):
    prd: PrdDocument
    tokens_used: int
    model: str


class ParseSpecRequest(BaseModel):
    file_url: str
    file_type: str = "pdf"
    notes: str = ""


class ParseSpecData(BaseModel):
    summary: str = ""
    features: list[str] = []
    target_users: str = ""
    integrations: list[str] = []
    tech_requirements: str = ""
    budget_hints: str = ""
    timeline_hints: str = ""
    completeness: int = Field(default=0, ge=0, le=100)


class ParseSpecResponse(BaseModel):
    success: bool = True
    data: ParseSpecData = ParseSpecData()


class MatchingRequest(BaseModel):
    project_id: str
    required_skills: list[str]
    budget: int | None = None
    timeline_days: int | None = None


class TalentScore(BaseModel):
    talent_id: str
    score: float
    skill_match: float
    pemerataan_score: float
    track_record: float
    rating: float
    is_exploration: bool = False


class MatchingResponse(BaseModel):
    project_id: str
    recommendations: list[TalentScore]
    exploration_count: int
    exploitation_count: int
