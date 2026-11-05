---- MODULE SnakeRules ----
EXTENDS Naturals, Sequences, FiniteSets

VARIABLES phase, aiMode, aiPending, body, food, dir, nextDir, score, eaten, ticks, haltTick

Phases == {"menu", "playing", "paused", "over"}
Dirs == {"R", "L", "U", "D"}
Rows == 3
Cols == 3
Cells == 1..(Rows * Cols)

Row(c) == (c - 1) \div Cols
Col(c) == (c - 1) % Cols

NextCell(c, d) ==
  CASE d = "R" -> IF Col(c) < Cols - 1 THEN c + 1 ELSE 0
    [] d = "L" -> IF Col(c) > 0 THEN c - 1 ELSE 0
    [] d = "U" -> IF Row(c) > 0 THEN c - Cols ELSE 0
    [] d = "D" -> IF Row(c) < Rows - 1 THEN c + Cols ELSE 0

Opposite(d) ==
  CASE d = "R" -> "L"
    [] d = "L" -> "R"
    [] d = "U" -> "D"
    [] OTHER -> "U"

Steer(d) == IF d = Opposite(dir) THEN dir ELSE d

CellsOf(s) == {s[i] : i \in 1..Len(s)}
Distinct(s) == \A i, j \in 1..Len(s) : i /= j => s[i] /= s[j]
FreeCells(b) == Cells \ CellsOf(b)
NextFood(b) == CHOOSE c \in FreeCells(b) : \A x \in FreeCells(b) : c <= x

HeadCell(b) == b[1]
TailBody(b) == SubSeq(b, 1, Len(b) - 1)

Init ==
  /\ phase = "menu"
  /\ aiMode = FALSE
  /\ aiPending = FALSE
  /\ body = <<5, 4, 1>>
  /\ food = 9
  /\ dir = "R"
  /\ nextDir = "R"
  /\ score = 0
  /\ eaten = 0
  /\ ticks = 0
  /\ haltTick = 0

InitBody ==
  /\ body' = <<5, 4, 1>>
  /\ food' = 9
  /\ dir' = "R"
  /\ nextDir' = "R"
  /\ score' = 0
  /\ eaten' = 0
  /\ ticks' = 0
  /\ haltTick' = 0

Start ==
  /\ phase = "menu"
  /\ phase' = "playing"
  /\ aiMode' = FALSE
  /\ aiPending' = FALSE
  /\ InitBody

StartAI ==
  /\ phase = "menu"
  /\ phase' = "playing"
  /\ aiMode' = TRUE
  /\ aiPending' = TRUE
  /\ InitBody

Pause ==
  /\ phase = "playing"
  /\ phase' = "paused"
  /\ haltTick' = ticks
  /\ UNCHANGED <<aiMode, aiPending, body, food, dir, nextDir, score, eaten, ticks>>

Resume ==
  /\ phase = "paused"
  /\ phase' = "playing"
  /\ UNCHANGED <<aiMode, aiPending, body, food, dir, nextDir, score, eaten, ticks, haltTick>>

AIRequest ==
  /\ phase = "playing"
  /\ aiMode = TRUE
  /\ ~aiPending
  /\ aiPending' = TRUE
  /\ UNCHANGED <<phase, aiMode, body, food, dir, nextDir, score, eaten, ticks, haltTick>>

AIRespond(d) ==
  /\ aiPending = TRUE
  /\ aiMode = TRUE
  /\ phase \in {"playing", "paused"}
  /\ d \in Dirs
  /\ aiPending' = FALSE
  /\ nextDir' = Steer(d)
  /\ UNCHANGED <<phase, aiMode, body, food, dir, score, eaten, ticks, haltTick>>

AIError ==
  /\ aiPending = TRUE
  /\ aiMode = TRUE
  /\ aiPending' = FALSE
  /\ UNCHANGED <<phase, aiMode, body, food, dir, nextDir, score, eaten, ticks, haltTick>>

Turn(d) ==
  /\ phase = "playing"
  /\ d \in Dirs
  /\ nextDir' = Steer(d)
  /\ UNCHANGED <<phase, aiMode, aiPending, body, food, dir, score, eaten, ticks, haltTick>>

Advance ==
  LET newHead == NextCell(HeadCell(body), nextDir)
      willEat == newHead = food
      hitWall == newHead = 0
      hitSelf == IF willEat
                  THEN newHead \in CellsOf(body)
                  ELSE newHead \in CellsOf(TailBody(body))
      dies == hitWall \/ hitSelf
      newBody == IF dies THEN body
                 ELSE IF willEat THEN <<newHead>> \o body
                 ELSE <<newHead>> \o TailBody(body)
      newFood == IF willEat /\ ~dies
                 THEN IF Cardinality(FreeCells(newBody)) > 0 THEN NextFood(newBody) ELSE 0
                 ELSE food
      newPhase == IF dies THEN "over"
                  ELSE IF willEat /\ newFood = 0 THEN "over"
                  ELSE "playing"
  IN
  /\ phase = "playing"
  /\ ticks' = ticks + 1
  /\ dir' = nextDir
  /\ nextDir' = nextDir
  /\ body' = newBody
  /\ food' = newFood
  /\ score' = IF willEat /\ ~dies THEN score + 10 ELSE score
  /\ eaten' = IF willEat /\ ~dies THEN eaten + 1 ELSE eaten
  /\ phase' = newPhase
  /\ haltTick' = IF newPhase = "over" THEN ticks' ELSE haltTick
  /\ UNCHANGED <<aiMode, aiPending>>

Restart ==
  /\ phase = "over"
  /\ phase' = "playing"
  /\ aiMode' = FALSE
  /\ aiPending' = FALSE
  /\ InitBody

RestartAI ==
  /\ phase = "over"
  /\ phase' = "playing"
  /\ aiMode' = TRUE
  /\ aiPending' = TRUE
  /\ InitBody

Done ==
  /\ phase = "over"
  /\ UNCHANGED <<phase, aiMode, aiPending, body, food, dir, nextDir, score, eaten, ticks, haltTick>>

AIRespondChoice == \E d \in Dirs : AIRespond(d)
TurnChoice == \E d \in Dirs : Turn(d)

Next ==
  \/ Start
  \/ StartAI
  \/ Pause
  \/ Resume
  \/ AIRequest
  \/ AIRespondChoice
  \/ AIError
  \/ TurnChoice
  \/ Advance
  \/ Restart
  \/ RestartAI
  \/ Done

TypeOK ==
  /\ phase \in Phases
  /\ aiMode \in BOOLEAN
  /\ aiPending \in BOOLEAN
  /\ body \in Seq(Cells)
  /\ food \in (Cells \cup {0})
  /\ dir \in Dirs
  /\ nextDir \in Dirs
  /\ score \in Nat
  /\ eaten \in Nat
  /\ ticks \in Nat
  /\ haltTick \in Nat

BodyOnBoard ==
  CellsOf(body) \subseteq Cells

NoOverlap ==
  Distinct(body)

FoodOnEmpty ==
  food = 0 \/ (food \in Cells /\ food \notin CellsOf(body))

FoodExistsInPlay ==
  phase \in {"playing", "paused"} => food /= 0

ScoreMatchesFood ==
  score = 10 * eaten

LengthMatchesFood ==
  Len(body) = 3 + eaten

NoReverse ==
  nextDir /= Opposite(dir)

HaltFreezesTicks ==
  phase \in {"paused", "over"} => ticks = haltTick

AIPendingOnlyInAI ==
  aiPending => aiMode

HeadIsFirst ==
  Len(body) > 0

MenuAtZero ==
  phase = "menu" => ticks = 0

EatenBounded ==
  eaten <= 2

TicksBounded ==
  ticks <= 12

====
