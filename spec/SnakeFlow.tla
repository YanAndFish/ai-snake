---- MODULE SnakeFlow ----
EXTENDS Naturals

VARIABLES phase, aiMode, aiPending, ticks, haltTick, score, length, dir, nextDir

Phases == {"menu", "playing", "paused", "over"}
Dirs == {"R", "L", "U", "D"}

Opposite(d) ==
  CASE d = "R" -> "L"
    [] d = "L" -> "R"
    [] d = "U" -> "D"
    [] OTHER -> "U"

Steer(d) == IF d = Opposite(dir) THEN dir ELSE d

Init ==
  /\ phase = "menu"
  /\ aiMode = FALSE
  /\ aiPending = FALSE
  /\ ticks = 0
  /\ haltTick = 0
  /\ score = 0
  /\ length = 3
  /\ dir = "R"
  /\ nextDir = "R"

Start ==
  /\ phase = "menu"
  /\ phase' = "playing"
  /\ aiMode' = FALSE
  /\ aiPending' = FALSE
  /\ ticks' = 0
  /\ haltTick' = 0
  /\ score' = 0
  /\ length' = 3
  /\ dir' = "R"
  /\ nextDir' = "R"

StartAI ==
  /\ phase = "menu"
  /\ phase' = "playing"
  /\ aiMode' = TRUE
  /\ aiPending' = TRUE
  /\ ticks' = 0
  /\ haltTick' = 0
  /\ score' = 0
  /\ length' = 3
  /\ dir' = "R"
  /\ nextDir' = "R"

Pause ==
  /\ phase = "playing"
  /\ phase' = "paused"
  /\ haltTick' = ticks
  /\ UNCHANGED <<aiMode, aiPending, ticks, score, length, dir, nextDir>>

Resume ==
  /\ phase = "paused"
  /\ phase' = "playing"
  /\ UNCHANGED <<aiMode, aiPending, ticks, haltTick, score, length, dir, nextDir>>

AIRequest ==
  /\ phase = "playing"
  /\ aiMode = TRUE
  /\ ~aiPending
  /\ aiPending' = TRUE
  /\ UNCHANGED <<phase, aiMode, ticks, haltTick, score, length, dir, nextDir>>

AIRespond(d) ==
  /\ aiPending = TRUE
  /\ aiMode = TRUE
  /\ phase \in {"playing", "paused"}
  /\ d \in Dirs
  /\ aiPending' = FALSE
  /\ nextDir' = Steer(d)
  /\ UNCHANGED <<phase, aiMode, ticks, haltTick, score, length, dir>>

AIError ==
  /\ aiPending = TRUE
  /\ aiMode = TRUE
  /\ aiPending' = FALSE
  /\ UNCHANGED <<phase, aiMode, ticks, haltTick, score, length, dir, nextDir>>

Turn(d) ==
  /\ phase = "playing"
  /\ d \in Dirs
  /\ nextDir' = Steer(d)
  /\ UNCHANGED <<phase, aiMode, aiPending, ticks, haltTick, score, length, dir>>

Tick ==
  /\ phase = "playing"
  /\ ticks' = ticks + 1
  /\ dir' = nextDir
  /\ nextDir' = nextDir
  /\ haltTick' = IF ticks' >= 5 THEN ticks' ELSE haltTick
  /\ phase' = IF ticks' >= 5 THEN "over" ELSE "playing"
  /\ UNCHANGED <<aiMode, aiPending, score, length>>

Restart ==
  /\ phase = "over"
  /\ phase' = "playing"
  /\ aiMode' = FALSE
  /\ aiPending' = FALSE
  /\ ticks' = 0
  /\ haltTick' = 0
  /\ score' = 0
  /\ length' = 3
  /\ dir' = "R"
  /\ nextDir' = "R"

RestartAI ==
  /\ phase = "over"
  /\ phase' = "playing"
  /\ aiMode' = TRUE
  /\ aiPending' = TRUE
  /\ ticks' = 0
  /\ haltTick' = 0
  /\ score' = 0
  /\ length' = 3
  /\ dir' = "R"
  /\ nextDir' = "R"

Done ==
  /\ phase = "over"
  /\ UNCHANGED <<phase, aiMode, aiPending, ticks, haltTick, score, length, dir, nextDir>>

AIRespondR == AIRespond("R")

Next ==
  \/ Start
  \/ StartAI
  \/ Pause
  \/ Resume
  \/ AIRequest
  \/ AIRespondR
  \/ AIError
  \/ Tick
  \/ Restart
  \/ RestartAI
  \/ Done

TypeOK ==
  /\ phase \in Phases
  /\ aiMode \in BOOLEAN
  /\ aiPending \in BOOLEAN
  /\ ticks \in Nat
  /\ haltTick \in Nat
  /\ score \in Nat
  /\ length \in Nat
  /\ dir \in Dirs
  /\ nextDir \in Dirs

HaltFreezesTicks ==
  phase \in {"paused", "over"} => ticks = haltTick

AIPendingOnlyInAI ==
  aiPending => aiMode

NoReverse ==
  nextDir /= Opposite(dir)

LengthAtLeastThree ==
  length >= 3

MenuAtZero ==
  phase = "menu" => ticks = 0

====
