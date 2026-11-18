# Pruebas del núcleo portátil (source/core) y de la lógica pura de la app (source/logic), con el gcc nativo del PC.
#   make test     compila y corre todo; sale con código distinto de cero si algo falla
#   make clean
# Desde el bash de devkitPro (MSYS2): los ejecutables son .exe.

CC      ?= gcc
CORE    := ../source/core
CORESRC := $(wildcard $(CORE)/*.c)
LOGIC   := ../source/logic
LOGICSRC := $(wildcard $(LOGIC)/*.c)
HEADERS := $(wildcard $(CORE)/*.h) $(wildcard $(LOGIC)/*.h) $(wildcard fixtures/*.h) test.h
TESTSRC := $(sort $(wildcard test_*.c))
EXES    := $(patsubst %.c,build/%.exe,$(TESTSRC))

# Sanitizadores: AddressSanitizer + UBSan si el gcc los trae; si no, UBSan que aborta en el primer fallo (no
# necesita librería de ejecución); si tampoco, nada. Se prueba compilando y enlazando un programa mínimo.
comma := ,
PROBE_SRC := build/probe.c
define probe
$(shell mkdir -p build; echo 'int main(void){return 0;}' > $(PROBE_SRC); $(CC) $(1) $(PROBE_SRC) -o build/probe.exe >/dev/null 2>&1 && echo ok)
endef
ifeq ($(call probe,-fsanitize=address$(comma)undefined),ok)
  SAN      := -fsanitize=address,undefined -fno-sanitize-recover=undefined
  SAN_NOTE := con AddressSanitizer y UBSan
else ifeq ($(call probe,-fsanitize=undefined -fsanitize-undefined-trap-on-error),ok)
  SAN      := -fsanitize=undefined -fsanitize-undefined-trap-on-error
  SAN_NOTE := con UBSan (trap), sin AddressSanitizer: este gcc no lo trae; las pruebas usan paginas de guarda
else
  SAN      :=
  SAN_NOTE := sin sanitizadores
endif

CFLAGS := -std=c99 -Wall -Wextra -Werror -O1 -g $(SAN)

.PHONY: all test clean
all: $(EXES)

build:
	mkdir -p build

build/%.exe: %.c $(CORESRC) $(LOGICSRC) $(HEADERS) | build
	$(CC) $(CFLAGS) $< $(CORESRC) $(LOGICSRC) -o $@ -lm

test: $(EXES)
	@echo "Compilado $(SAN_NOTE)"
	@total=0; failed=0; \
	for t in $(EXES); do \
	  out=$$(./$$t); rc=$$?; \
	  echo "$$out"; \
	  n=$$(echo "$$out" | sed -n 's/^ASSERTIONS \([0-9]*\) FAILED.*/\1/p' | tail -1); \
	  total=$$((total + $${n:-0})); \
	  if [ $$rc -ne 0 ]; then failed=$$((failed + 1)); echo "FALLO: $$t (codigo $$rc)"; fi; \
	done; \
	echo "TOTAL: $$total aserciones, $$failed ejecutables con fallos ($(SAN_NOTE))"; \
	[ $$failed -eq 0 ]

clean:
	rm -rf build
