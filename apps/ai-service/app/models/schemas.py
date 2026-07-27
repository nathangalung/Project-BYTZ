from pydantic import BaseModel, Field, field_validator


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
    # Keys of BRD info still missing, so the UI can prompt for them.
    missing: list[str] = []


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
    # "id" or "en"; the owner picks and the PDF renderer reads it.
    language: str = "id"


class GenerateBrdRequest(BaseModel):
    project_id: str
    conversation_history: list[ChatMessage]
    project_category: str
    budget_min: int | None = None
    budget_max: int | None = None
    timeline_days: int | None = None
    language: str = "id"
    # A revision regenerates from the current document plus an instruction.
    current_document: dict = {}
    revision_instruction: str = ""

    @field_validator("timeline_days", "budget_min", "budget_max", mode="before")
    @classmethod
    def _reject_bool(cls, v: object) -> object:
        if isinstance(v, bool):
            raise ValueError("must be an integer, not a boolean")
        return v


class BrdSectionScore(BaseModel):
    section: str  # Template section code: B, D, E, H, K, L, M
    label: str
    score: int = Field(ge=0, le=100)
    reason: str = ""


class BrdTemplateScore(BaseModel):
    """Completeness score of generated BRD against template sections (A-N)."""
    # Default 0 = "not yet scored". Required-without-default broke
    # GenerateBrdResponse, whose default_factory calls BrdTemplateScore().
    overall: int = Field(default=0, ge=0, le=100)
    sections: list[BrdSectionScore] = []


class GenerateBrdResponse(BaseModel):
    brd: BrdDocument
    tokens_used: int
    model: str
    template_score: BrdTemplateScore = Field(default_factory=BrdTemplateScore)


class CvParseRequest(BaseModel):
    talent_id: str
    # min_length so "no file" is a schema violation (422 with the standard
    # HTTPValidationError shape) rather than an ad-hoc handler rejection.
    # Matches ParseSpecRequest below.
    file_url: str = Field(min_length=1)
    file_type: str = "pdf"


# CV entry models.
#
# These exist because Instructor derives the LLM's JSON schema from the Pydantic
# model - the model IS the prompt. Declaring these as bare `list[dict]` emitted a
# schema saying only "array of objects" with no properties, so the field shape
# survived purely as English prose in a description, GPT-4o was free to invent
# key names, and Instructor's retry loop had nothing to validate against.
# Every field carries a description because each one reaches the model.
#
# All fields are optional: a CV that omits a GPA should still parse.


class EducationEntry(BaseModel):
    university: str = Field(default="", description="Institution name, e.g. Universitas Indonesia")
    degree: str = Field(default="", description="Degree level, e.g. S1, S2, Bachelor, Master")
    major: str = Field(default="", description="Field of study, e.g. Teknik Informatika")
    gpa: str | None = Field(default=None, description="GPA or IPK as written, e.g. 3.54")
    start: str = Field(default="", description="Start year or month-year as written")
    end: str = Field(
        default="", description="End year, or 'present'/'sekarang' if still studying"
    )


class ExperienceEntry(BaseModel):
    company: str = Field(default="", description="Employer or organisation name")
    position: str = Field(default="", description="Job title or role held")
    start: str = Field(default="", description="Start date as written, e.g. 2020 or January 2020")
    end: str = Field(default="", description="End date, or 'present'/'sekarang' if ongoing")
    description: str = Field(
        default="", description="What they did - responsibilities and achievements"
    )
    is_current: bool = Field(default=False, description="True if this is the current role")


class ProjectEntry(BaseModel):
    title: str = Field(default="", description="Project name")
    description: str = Field(default="", description="What the project does")
    tech_stack: list[str] = Field(
        default_factory=list,
        description="Technologies used, often listed after '|' or inside parentheses",
    )
    url: str = Field(default="", description="Repository or demo URL if present")


class CertificationEntry(BaseModel):
    name: str = Field(default="", description="Certification name")
    issuer: str = Field(default="", description="Issuing body, e.g. AWS, IBM, Coursera")
    year: str = Field(default="", description="Year obtained as written")
    tech_tags: list[str] = Field(
        default_factory=list,
        description="Technologies the certification covers, e.g. 'IBM AI Engineering | Python, PyTorch'",
    )


class CvParsedData(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    summary: str | None = None
    education: list[EducationEntry] = []
    experience: list[ExperienceEntry] = []
    organizational_experience: list[ExperienceEntry] = []
    projects: list[ProjectEntry] = []
    skills: list[str] = []
    certifications: list[CertificationEntry] = []
    portfolio_urls: list[str] = []
    years_of_experience: int | None = None


class CvParseResponse(BaseModel):
    talent_id: str
    parsed_data: CvParsedData
    confidence_score: float
    raw_text: str = ""


class Deliverable(BaseModel):
    """A concrete output a talent must produce. Shape matches the deliverable
    checklist stored in milestones.metadata, so a work package maps straight to
    a milestone without reshaping."""

    title: str = Field(default="", description="Deliverable name, e.g. 'REST API documentation'")
    type: str = Field(default="document", description="One of: code, document, file, demo")
    expected: str = Field(
        default="",
        description="What a complete, acceptable deliverable looks like, e.g. 'OpenAPI 3.1 spec covering every endpoint'",
    )


class WorkPackageSpec(BaseModel):
    title: str
    description: str = ""
    required_skills: list[str] = []
    estimated_hours: float = 0
    amount: int = 0
    deliverables: list[Deliverable] = Field(
        default_factory=list,
        description="Concrete, typed outputs the talent must produce for this package",
    )
    acceptance_criteria: list[str] = Field(
        default_factory=list,
        description="Verifiable, testable statements the owner checks to accept the work",
    )


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
    assumptions: list[str] = []
    risks: list[str] = []
    estimated_price_min: int = 0
    estimated_price_max: int = 0
    estimated_timeline_days: int = 0
    estimated_team_size: int = 1
    # "id" or "en"; the owner picks and the PDF renderer reads it.
    language: str = "id"


class GeneratePrdRequest(BaseModel):
    project_id: str
    conversation_history: list[ChatMessage] = []
    brd_content: dict = {}
    project_category: str = "web_app"
    budget_min: int | None = None
    budget_max: int | None = None
    timeline_days: int | None = None
    language: str = "id"
    # A revision regenerates from the current document plus an instruction.
    current_document: dict = {}
    revision_instruction: str = ""

    @field_validator("timeline_days", "budget_min", "budget_max", mode="before")
    @classmethod
    def _reject_bool(cls, v: object) -> object:
        if isinstance(v, bool):
            raise ValueError("must be an integer, not a boolean")
        return v


class GeneratePrdResponse(BaseModel):
    prd: PrdDocument
    tokens_used: int
    model: str


class ParseSpecRequest(BaseModel):
    file_url: str = Field(min_length=1)
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
