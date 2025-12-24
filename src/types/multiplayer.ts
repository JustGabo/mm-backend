export interface ImpostorPhasesGenerationRequest {
    roomId: string
    caseType: string
    suspects: number
    clues: number
    scenario: string
    difficulty: string
    style?: 'realistic' | 'pixel'
    language?: string
  }
  
  export interface PlayerPhaseInfo {
    playerId: string
    photo?: string
    phase1: {
      name: string
      occupation: string
      relationshipWithVictim: string
      description: string
      gender?: string
    }
    phase2: {
      observations: string[]
    }
    phase3: {
      timeline: Array<{
        time: string
        location: string
        activity: string
        observations?: string[]
      }>
    }
    phase4: {
      isKiller: boolean
      whySuspicious: string
      alibi: string
      suspiciousBehavior?: string
    }
  }
  
  export interface ImpostorPhasesResponse {
    caseTitle: string
    caseDescription: string
    victim: {
      name: string
      age: number
      role: string
      description: string
      causeOfDeath?: string
      timeOfDeath?: string
      timeOfDiscovery?: string
      discoveredBy?: string
      location?: string
      bodyPosition?: string
      visibleInjuries?: string
      objectsAtScene?: string
      signsOfStruggle?: string
    }
    weapon?: {
      id: string
      name: string
      description: string
      location: string
      photo: string
      importance: 'high'
    }
    players: PlayerPhaseInfo[]
    hiddenContext: {
      killerId: string
      killerReason: string
      keyClues: string[]
      killerTraits: string[]
    }
    config: {
      caseType: string
      totalClues: number
      scenario: string
      difficulty: string
    }
  }
  
  export interface ImpostorPhasesDiscussionRequest {
    roomId: string
    roundNumber: number
    language?: string
  }
  
  export interface ImpostorPhasesDiscussionResponse {
    id: number
    title: string
    type: "question" | "inconsistency" | "observation" | "discovery"
    content: string
    context?: string
    suggestions: string[]
    targetedPlayers?: string[]
    discovery?: {
      description: string
      implications?: string[]
    }
  }
  
  export interface GenerateAllRoundsRequest {
    roomId: string
    language?: string
  }