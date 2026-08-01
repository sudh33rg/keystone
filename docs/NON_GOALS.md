# Current-Release Non-Goals

Keystone intentionally excludes:

## IDE Hosts Other Than VS Code

### Rationale

Keystone is designed as a VS Code extension to leverage VS Code's rich ecosystem of language servers, debugging tools, and extension APIs. Building a multi-IDE solution would:

- Require significant resources to maintain multiple IDE integrations
- Fragment the user experience across different IDEs
- Increase complexity and development time
- Reduce focus on delivering a best-in-class VS Code experience

### Architectural Impact

- **Tight Integration**: Deep integration with VS Code's extension APIs, language servers, and debugging tools
- **Single Codebase**: One codebase for the extension, webview, and browser view
- **VS Code Specific Features**: Use of VS Code-specific features like quick pick, hover, and panel APIs
- **Extension Host Architecture**: Single extension host model for state management

### Future Extensibility

While Keystone is currently VS Code-only, the architecture is designed to be extensible:

- **Core Intelligence Layer**: The core intelligence layer is platform-agnostic
- **Adapter Pattern**: The extension layer uses an adapter pattern to interface with VS Code
- **Plugin Architecture**: Future plugins could support other IDEs
- **Web API**: The browser view provides a web-based interface that could be embedded

## Separate Cloud/Headless Product Runtime

### Rationale

Keystone is designed as a local-first tool to:

- Ensure data privacy and security
- Eliminate dependency on cloud services
- Provide offline functionality
- Reduce latency and improve performance
- Maintain complete control over data

Building a separate cloud product would:

- Introduce data privacy concerns
- Create dependency on cloud services
- Require additional infrastructure and maintenance
- Increase complexity and cost
- Compromise the local-first principle

### Architectural Impact

- **Local-First Design**: All processing occurs locally on the user's machine
- **No Cloud Dependencies**: No cloud services are required for core functionality
- **Offline Capability**: Full functionality available without internet connection
- **Data Sovereignty**: User data never leaves their machine
- **Performance**: Local processing ensures low latency and high performance

### Future Extensibility

While Keystone is currently local-first, the architecture is designed to be extensible:

- **Cloud API**: A cloud API could be added as a plugin
- **Sync Layer**: A sync layer could be added to support cloud storage
- **Hybrid Mode**: A hybrid mode could be added to support cloud features
- **Cloud Integration**: Cloud features could be added as opt-in extensions

## Authentication, SSO, Manager Assignment, Organization Dashboards, or Cloud Synchronization

### Rationale

Keystone is designed for individual developers and small teams. Adding enterprise features would:

- Increase complexity and development time
- Require additional infrastructure and maintenance
- Compromise the local-first principle
- Introduce unnecessary complexity for individual users
- Create data privacy concerns

### Architectural Impact

- **No Authentication**: No user authentication system
- **No SSO**: No single sign-on integration
- **No Manager Assignment**: No team or manager assignment
- **No Dashboards**: No organization dashboards
- **No Cloud Sync**: No cloud synchronization
- **Local State**: All state is stored locally

### Future Extensibility

While Keystone is currently designed for individual use, the architecture is designed to be extensible:

- **Authentication Plugin**: An authentication plugin could be added
- **SSO Integration**: SSO integration could be added as a plugin
- **Team Management**: Team management features could be added as a plugin
- **Dashboard Plugin**: Dashboard features could be added as a plugin
- **Cloud Sync Plugin**: Cloud sync features could be added as a plugin

## Local SLM/Ollama Routing, Fine-Tuning, LoRA, or Model Training

### Rationale

Keystone is designed as an intelligence layer that enhances existing AI systems, not as an AI model itself. Building local AI infrastructure would:

- Require significant resources for model training and maintenance
- Increase complexity and development time
- Require specialized hardware
- Compromise the local-first principle
- Create data privacy concerns

### Architectural Impact

- **AI Agnostic**: No dependency on specific AI models
- **Copilot Integration**: Uses existing Copilot services
- **No Model Training**: No model training infrastructure
- **No Fine-Tuning**: No fine-tuning infrastructure
- **No LoRA**: No LoRA infrastructure
- **No SLM**: No local SLM infrastructure

### Future Extensibility

While Keystone is currently AI-agnostic, the architecture is designed to be extensible:

- **Model Plugin**: A model plugin could be added
- **Fine-Tuning Plugin**: A fine-tuning plugin could be added
- **LoRA Plugin**: A LoRA plugin could be added
- **SLM Plugin**: An SLM plugin could be added
- **Ollama Integration**: Ollama integration could be added as a plugin

## Autonomous or Unattended Source-Code Mutation

### Rationale

Keystone is designed to augment human developers, not replace them. Autonomous code mutation would:

- Compromise code quality and security
- Create accountability and liability issues
- Reduce developer ownership and understanding
- Increase risk of unintended consequences
- Compromise the local-first principle

### Architectural Impact

- **Human-in-the-Loop**: All changes require human approval
- **No Autonomous Changes**: No autonomous code changes
- **Approval Required**: All changes require explicit approval
- **No Auto-Commit**: No auto-commit functionality
- **No Auto-PR**: No auto-PR functionality

### Future Extensibility

While Keystone is currently human-in-the-loop, the architecture is designed to be extensible:

- **Autonomous Plugin**: An autonomous plugin could be added
- **Auto-Commit Plugin**: An auto-commit plugin could be added
- **Auto-PR Plugin**: An auto-PR plugin could be added
- **AI Assistant Plugin**: An AI assistant plugin could be added

## Credential, Token, or Repository Archive Transfer

### Rationale

Keystone is designed to be secure and privacy-preserving. Transferring credentials, tokens, or repository archives would:

- Create significant security risks
- Compromise data privacy
- Increase attack surface
- Create compliance issues
- Compromise the local-first principle

### Architectural Impact

- **No Credential Transfer**: No credentials are transferred
- **No Token Transfer**: No tokens are transferred
- **No Repository Archive Transfer**: No repository archives are transferred
- **Redaction**: Sensitive information is redacted
- **Encryption**: Data is encrypted in transit

### Future Extensibility

While Keystone is currently designed to avoid credential transfer, the architecture is designed to be extensible:

- **Credential Plugin**: A credential plugin could be added
- **Token Plugin**: A token plugin could be added
- **Archive Plugin**: An archive plugin could be added
- **Secure Transfer Plugin**: A secure transfer plugin could be added

## Git Write Operations

### Rationale

Keystone is designed as a read-only tool to:

- Ensure data integrity
- Prevent accidental changes
- Maintain safety
- Avoid conflicts with other tools
- Maintain the local-first principle

Implementing Git write operations would:

- Increase complexity and development time
- Create risk of accidental changes
- Compromise data integrity
- Create conflicts with other tools
- Compromise the local-first principle

### Architectural Impact

- **Read-Only Git**: All Git operations are read-only
- **No Staging**: No staging of changes
- **No Committing**: No committing of changes
- **No Pushing**: No pushing of changes
- **No Branch Creation**: No branch creation
- **No PR/MR Creation**: No PR/MR creation
- **No Approval**: No approval functionality
- **No Merge**: No merge functionality

### Future Extensibility

While Keystone is currently read-only, the architecture is designed to be extensible:

- **Git Write Plugin**: A Git write plugin could be added
- **Staging Plugin**: A staging plugin could be added
- **Commit Plugin**: A commit plugin could be added
- **Push Plugin**: A push plugin could be added
- **Branch Plugin**: A branch plugin could be added
- **PR/MR Plugin**: A PR/MR plugin could be added
- **Approval Plugin**: An approval plugin could be added
- **Merge Plugin**: A merge plugin could be added

## Remote PR/MR Creation, Update, Approval, Merge, or Submission

### Rationale

Keystone is designed to enhance code review, not replace it. Remote PR/MR operations would:

- Complicate the local-first principle
- Increase complexity and development time
- Create dependency on remote systems
- Create security risks
- Compromise data privacy

### Architectural Impact

- **Read-Only PR/MR**: All PR/MR operations are read-only
- **No Creation**: No PR/MR creation
- **No Update**: No PR/MR update
- **No Approval**: No PR/MR approval
- **No Merge**: No PR/MR merge
- **No Submission**: No PR/MR submission
- **Review Only**: Review only functionality

### Future Extensibility

While Keystone is currently read-only for PR/MR operations, the architecture is designed to be extensible:

- **PR/MR Plugin**: A PR/MR plugin could be added
- **Creation Plugin**: A creation plugin could be added
- **Update Plugin**: An update plugin could be added
- **Approval Plugin**: An approval plugin could be added
- **Merge Plugin**: A merge plugin could be added
- **Submission Plugin**: A submission plugin could be added

## CI/CD Replacement, Deployment, or Release Automation

### Rationale

Keystone is designed to enhance the development process, not replace CI/CD systems. CI/CD automation would:

- Complicate the local-first principle
- Increase complexity and development time
- Create dependency on CI/CD systems
- Create security risks
- Compromise data privacy

### Architectural Impact

- **No CI/CD Integration**: No CI/CD integration
- **No Deployment**: No deployment functionality
- **No Release Automation**: No release automation
- **No Build Automation**: No build automation
- **No Test Automation**: No test automation
- **No Pipeline Automation**: No pipeline automation

### Future Extensibility

While Keystone is currently not a CI/CD system, the architecture is designed to be extensible:

- **CI/CD Plugin**: A CI/CD plugin could be added
- **Deployment Plugin**: A deployment plugin could be added
- **Release Automation Plugin**: A release automation plugin could be added
- **Build Automation Plugin**: A build automation plugin could be added
- **Test Automation Plugin**: A test automation plugin could be added
- **Pipeline Automation Plugin**: A pipeline automation plugin could be added

## Browser View as Separate Server Product

### Rationale

The Browser View is designed as a presentation surface for the active extension runtime, not as a separate server product. Making it a separate server would:

- Compromise the single-instance design
- Increase complexity and development time
- Create dependency on server infrastructure
- Create security risks
- Compromise data privacy

### Architectural Impact

- **One Instance**: One extension host
- **One Store**: One application store
- **One Identity**: One workspace identity
- **One Snapshot**: One intelligence snapshot
- **One Engine**: One SDLC engine
- **One State**: One Task Handoff state
- **One Command Path**: One command path
- **Loopback Transport**: Authenticated loopback HTTP/SSE transport
- **Same Code**: Same application code

### Future Extensibility

While the Browser View is currently a presentation surface, the architecture is designed to be extensible:

- **Server Plugin**: A server plugin could be added
- **Separate Server Plugin**: A separate server plugin could be added
- **Cloud Plugin**: A cloud plugin could be added
- **Hybrid Plugin**: A hybrid plugin could be added

The non-goals ensure that Keystone remains focused on its core mission: converting unknown repositories into deterministic, evidence-backed engineering intelligence and using that intelligence to drive an intent-led SDLC. The architecture is designed to be extensible, allowing future features to be added as plugins without compromising the core principles.