#---------------------------------------------------------------------------------
.SUFFIXES:
#---------------------------------------------------------------------------------

ifeq ($(strip $(DEVKITARM)),)
$(error "Please set DEVKITARM in your environment. export DEVKITARM=<path to>devkitARM")
endif

TOPDIR ?= $(CURDIR)
include $(DEVKITARM)/3ds_rules

#---------------------------------------------------------------------------------
# TARGET is the name of the output
# BUILD is the directory where object files & intermediate files will be placed
# SOURCES is a list of directories containing source code
# DATA is a list of directories containing data files
# INCLUDES is a list of directories containing header files
# GRAPHICS is a list of directories containing graphics files
# GFXBUILD is the directory where converted graphics files will be placed
#   If set to $(BUILD), it will statically link in the converted
#   files as if they were data files.
#
# NO_SMDH: if set to anything, no SMDH file is generated.
# ROMFS is the directory which contains the RomFS, relative to the Makefile (Optional)
# APP_TITLE is the name of the app stored in the SMDH file (Optional)
# APP_DESCRIPTION is the description of the app stored in the SMDH file (Optional)
# APP_AUTHOR is the author of the app stored in the SMDH file (Optional)
# ICON is the filename of the icon (.png), relative to the project folder.
#   If not set, it attempts to use one of the following (in this order):
#     - <Project name>.png
#     - icon.png
#     - <libctru folder>/default_icon.png
#---------------------------------------------------------------------------------
TARGET		:=	agent-companion
BUILD		:=	build
SOURCES		:=	source source/core source/logic
DATA		:=	data
INCLUDES	:=	include
GRAPHICS	:=	gfx
GFXBUILD	:=	$(BUILD)

APP_TITLE	:=	Cronio
APP_DESCRIPTION	:=	Aprueba permisos de agentes de IA desde la 3DS
APP_AUTHOR	:=	Alonso Rojas

# Versión de la app: la única fuente. Va al código C (-DAPP_VERSION, el saludo con el puente y la comparación para actualizar), al .cia (makerom
# -major/-minor/-micro: la versión del título; major y minor hasta 63, micro hasta 15) y a agent-companion.version, que `make cia` deja junto al .cia
# y de donde el puente lee la versión que ofrece a las consolas.
APP_VERSION := 0.3.4
APP_MAJOR	:=	$(word 1,$(subst ., ,$(APP_VERSION)))
APP_MINOR	:=	$(word 2,$(subst ., ,$(APP_VERSION)))
APP_MICRO	:=	$(word 3,$(subst ., ,$(APP_VERSION)))

# Instalable .cia (FBI): arte y plantilla en cia/. El icono del .3dsx es el mismo.
CIA_DIR		:=	cia
ICON		:=	$(CIA_DIR)/icon.png

# Herramientas del .cia (no vienen con devkitPro por defecto: ver docs/10-fase-7-instalador.md)
BANNERTOOL	?=	$(DEVKITPRO)/tools/bin/bannertool
MAKEROM		?=	$(DEVKITPRO)/tools/bin/makerom

#---------------------------------------------------------------------------------
# options for code generation
#---------------------------------------------------------------------------------
ARCH	:=	-march=armv6k -mtune=mpcore -mfloat-abi=hard -mtp=soft

CFLAGS	:=	-g -Wall -Wextra -std=gnu99 -O2 -mword-relocations \
			-ffunction-sections \
			$(ARCH)

CFLAGS	+=	$(INCLUDE) -D__3DS__ -DAPP_VERSION=\"$(APP_VERSION)\"

CXXFLAGS	:= $(CFLAGS) -fno-rtti -fno-exceptions -std=gnu++11

ASFLAGS	:=	-g $(ARCH)
LDFLAGS	=	-specs=3dsx.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)

LIBS	:= -lcitro2d -lcitro3d -lctru -lm

#---------------------------------------------------------------------------------
# list of directories containing libraries, this must be the top level containing
# include and lib
#---------------------------------------------------------------------------------
LIBDIRS	:= $(CTRULIB)


#---------------------------------------------------------------------------------
# no real need to edit anything past this point unless you need to add additional
# rules for different file extensions
#---------------------------------------------------------------------------------
ifneq ($(BUILD),$(notdir $(CURDIR)))
#---------------------------------------------------------------------------------

export OUTPUT	:=	$(CURDIR)/$(TARGET)
export TOPDIR	:=	$(CURDIR)

export VPATH	:=	$(foreach dir,$(SOURCES),$(CURDIR)/$(dir)) \
			$(foreach dir,$(GRAPHICS),$(CURDIR)/$(dir)) \
			$(foreach dir,$(DATA),$(CURDIR)/$(dir))

export DEPSDIR	:=	$(CURDIR)/$(BUILD)

CFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
CPPFILES	:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.cpp)))
SFILES		:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.s)))
PICAFILES	:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.v.pica)))
SHLISTFILES	:=	$(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.shlist)))
GFXFILES	:=	$(foreach dir,$(GRAPHICS),$(notdir $(wildcard $(dir)/*.t3s)))
BINFILES	:=	$(foreach dir,$(DATA),$(notdir $(wildcard $(dir)/*.*)))

#---------------------------------------------------------------------------------
# use CXX for linking C++ projects, CC for standard C
#---------------------------------------------------------------------------------
ifeq ($(strip $(CPPFILES)),)
#---------------------------------------------------------------------------------
	export LD	:=	$(CC)
#---------------------------------------------------------------------------------
else
#---------------------------------------------------------------------------------
	export LD	:=	$(CXX)
#---------------------------------------------------------------------------------
endif
#---------------------------------------------------------------------------------

export T3XFILES		:=	$(GFXFILES:.t3s=.t3x)

export OFILES_SOURCES 	:=	$(CPPFILES:.cpp=.o) $(CFILES:.c=.o) $(SFILES:.s=.o)

export OFILES_BIN	:=	$(addsuffix .o,$(BINFILES)) \
			$(PICAFILES:.v.pica=.shbin.o) $(SHLISTFILES:.shlist=.shbin.o) \
			$(if $(filter $(BUILD),$(GFXBUILD)),$(addsuffix .o,$(T3XFILES)))

export OFILES := $(OFILES_BIN) $(OFILES_SOURCES)

export HFILES	:=	$(PICAFILES:.v.pica=_shbin.h) $(SHLISTFILES:.shlist=_shbin.h) \
			$(addsuffix .h,$(subst .,_,$(BINFILES))) \
			$(GFXFILES:.t3s=.h)

export INCLUDE	:=	$(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) \
			$(foreach dir,$(LIBDIRS),-I$(dir)/include) \
			-I$(CURDIR)/$(BUILD)

export LIBPATHS	:=	$(foreach dir,$(LIBDIRS),-L$(dir)/lib)

export _3DSXDEPS	:=	$(if $(NO_SMDH),,$(OUTPUT).smdh)

ifeq ($(strip $(ICON)),)
	icons := $(wildcard *.png)
	ifneq (,$(findstring $(TARGET).png,$(icons)))
		export APP_ICON := $(TOPDIR)/$(TARGET).png
	else
		ifneq (,$(findstring icon.png,$(icons)))
			export APP_ICON := $(TOPDIR)/icon.png
		endif
	endif
else
	export APP_ICON := $(TOPDIR)/$(ICON)
endif

ifeq ($(strip $(NO_SMDH)),)
	export _3DSXFLAGS += --smdh=$(CURDIR)/$(TARGET).smdh
endif

ifneq ($(ROMFS),)
	export _3DSXFLAGS += --romfs=$(CURDIR)/$(ROMFS)
endif

.PHONY: all clean cia cia-banner-test

#---------------------------------------------------------------------------------
all:
	@mkdir -p $(BUILD) $(GFXBUILD)
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile

#---------------------------------------------------------------------------------
# cia: arma agent-companion.cia a partir del .elf (compila antes si hace falta).
#   banner 3D + sonido -> build/banner.bnr, icono -> build/icon.icn, y makerom lo junta con el .rsf.
#---------------------------------------------------------------------------------
# Banner 3D del menú HOME: variante D de cia/gen-banner3d-v2.py (solo el logo, en capas, con parpadeo y respiro por escala).
# Probada en la consola con la app de prueba (cia-banner-test). El generador alinea las texturas a 128 bytes y verifica el .cgfx.
BANNER_3D	?=	d
PYTHON		?=	$(if $(wildcard /c/Python314/python.exe),/c/Python314/python,python)

cia: all
	@echo armando $(TARGET).cia ...
	@$(PYTHON) $(CIA_DIR)/gen-banner3d-v2.py $(BANNER_3D) $(BUILD)/banner.cgfx > $(BUILD)/banner.txt || { cat $(BUILD)/banner.txt; exit 1; }
	@$(BANNERTOOL) makebanner -ci $(BUILD)/banner.cgfx -a $(CIA_DIR)/banner.wav -o $(BUILD)/banner.bnr
	@$(BANNERTOOL) makesmdh -s "$(APP_TITLE)" -l "$(APP_TITLE)" -p "$(APP_AUTHOR)" -i $(CIA_DIR)/icon.png -o $(BUILD)/icon.icn
	@$(MAKEROM) -f cia -o $(TARGET).cia -target t -exefslogo -elf $(TARGET).elf -rsf $(CIA_DIR)/$(TARGET).rsf -icon $(BUILD)/icon.icn -banner $(BUILD)/banner.bnr -major $(APP_MAJOR) -minor $(APP_MINOR) -micro $(APP_MICRO)
	@printf '%s' '$(APP_VERSION)' > $(TARGET).version
	@echo "hecho: $(TARGET).cia $(APP_VERSION) (y $(TARGET).version)"

#---------------------------------------------------------------------------------
# cia-banner-test: APP DE PRUEBA para probar banners del menú HOME sin arriesgar la app real. Arma cinco .cia
# (cronio-banner-test-a/b/c/d/e.cia) con el mismo .elf y el icono real, pero con UniqueId, ProductCode y nombre propios
# (cia/banner-test.rsf, plantilla). No toca el objetivo `cia` ni cia/agent-companion.rsf. Ver cia/README-banner3d.md.
#   A  banner plano actual (control)               D  como C con animación de escala (huesos en el origen)
#   B  solo la placa del logo, una textura         E  como D + huesos con pivote propio, saltito y mirada
#   C  el logo en capas con profundidad, estático  (sin fondo: se ve el del menú HOME)
# Las B..E salen de cia/gen-banner3d-v2.py (alineación a 128 bytes y billboard; verifica el .cgfx al generarlo y deja
# una vista previa de frente en build/banner-test/<v>.png).
# UniqueId: A 0xF7A3D, B 0xF7A3E, C 0xF7A3F, D 0xF7A40, E 0xF7A41 (la app real es 0xF7A3C).
#---------------------------------------------------------------------------------
BT_VARIANTES	:=	a b c d e

cia-banner-test: all
	@mkdir -p $(BUILD)/banner-test
	@for v in $(BT_VARIANTES); do \
		V=$$(echo $$v | tr a-z A-Z); \
		case $$v in a) ID=0xF7A3D;; b) ID=0xF7A3E;; c) ID=0xF7A3F;; d) ID=0xF7A40;; e) ID=0xF7A41;; esac; \
		echo "armando cronio-banner-test-$$v.cia (Banner $$V, UniqueId $$ID) ..."; \
		if [ $$v = a ]; then \
			$(BANNERTOOL) makebanner -i $(CIA_DIR)/banner.png -a $(CIA_DIR)/banner.wav -o $(BUILD)/banner-test/$$v.bnr || exit 1; \
			cp $(CIA_DIR)/banner.png $(BUILD)/banner-test/$$v.png; \
		else \
			$(PYTHON) $(CIA_DIR)/gen-banner3d-v2.py $$v $(BUILD)/banner-test/$$v.cgfx > $(BUILD)/banner-test/$$v.txt || { cat $(BUILD)/banner-test/$$v.txt; exit 1; }; \
			$(BANNERTOOL) makebanner -ci $(BUILD)/banner-test/$$v.cgfx -a $(CIA_DIR)/banner.wav -o $(BUILD)/banner-test/$$v.bnr || exit 1; \
		fi; \
		$(BANNERTOOL) makesmdh -s "Banner $$V" -l "Cronio banner de prueba $$V" -p "$(APP_AUTHOR)" -i $(CIA_DIR)/icon.png -o $(BUILD)/banner-test/$$v.icn || exit 1; \
		sed -e "s/@TITULO@/Banner $$V/" -e "s/@CODIGO@/CTR-H-BNR$$V/" -e "s/@ID@/$$ID/" $(CIA_DIR)/banner-test.rsf > $(BUILD)/banner-test/$$v.rsf; \
		$(MAKEROM) -f cia -o cronio-banner-test-$$v.cia -target t -exefslogo -elf $(TARGET).elf -rsf $(BUILD)/banner-test/$$v.rsf -icon $(BUILD)/banner-test/$$v.icn -banner $(BUILD)/banner-test/$$v.bnr -major $(APP_MAJOR) -minor $(APP_MINOR) -micro $(APP_MICRO) || exit 1; \
	done
	@echo "hecho: cronio-banner-test-{a,b,c,d,e}.cia y vistas previas en $(BUILD)/banner-test/*.png (ver cia/README-banner3d.md)"

#---------------------------------------------------------------------------------
clean:
	@echo clean ...
	@rm -fr $(BUILD) $(TARGET).3dsx $(OUTPUT).smdh $(TARGET).elf $(TARGET).cia $(TARGET).version


#---------------------------------------------------------------------------------
else

#---------------------------------------------------------------------------------
# main targets
#---------------------------------------------------------------------------------
$(OUTPUT).3dsx	:	$(OUTPUT).elf $(_3DSXDEPS)

$(OFILES_SOURCES) : $(HFILES)

# la versión (-DAPP_VERSION) entra por el Makefile: si cambia, app.c se compila de nuevo
app.o : $(TOPDIR)/Makefile

$(OUTPUT).elf	:	$(OFILES)

#---------------------------------------------------------------------------------
# you need a rule like this for each extension you use as binary data
#---------------------------------------------------------------------------------
%.bin.o	%_bin.h :	%.bin
#---------------------------------------------------------------------------------
	@echo $(notdir $<)
	@$(bin2o)

#---------------------------------------------------------------------------------
.PRECIOUS	:	%.t3x
%.t3x.o	%_t3x.h :	%.t3x
#---------------------------------------------------------------------------------
	@$(bin2o)

#---------------------------------------------------------------------------------
# rules for assembling GPU shaders
#---------------------------------------------------------------------------------
define shader-as
	$(eval CURBIN := $*.shbin)
	$(eval DEPSFILE := $(DEPSDIR)/$*.shbin.d)
	echo "$(CURBIN).o: $< $1" > $(DEPSFILE)
	echo "extern const u8" `(echo $(CURBIN) | sed -e 's/^\([0-9]\)/_\1/' | tr . _)`"_end[];" > `(echo $(CURBIN) | tr . _)`.h
	echo "extern const u8" `(echo $(CURBIN) | sed -e 's/^\([0-9]\)/_\1/' | tr . _)`"[];" >> `(echo $(CURBIN) | tr . _)`.h
	echo "extern const u32" `(echo $(CURBIN) | sed -e 's/^\([0-9]\)/_\1/' | tr . _)`_size";" >> `(echo $(CURBIN) | tr . _)`.h
	picasso -o $(CURBIN) $1
	bin2s $(CURBIN) | $(AS) -o $*.shbin.o
endef

%.shbin.o %_shbin.h : %.v.pica %.g.pica
	@echo $(notdir $^)
	@$(call shader-as,$^)

%.shbin.o %_shbin.h : %.v.pica
	@echo $(notdir $<)
	@$(call shader-as,$<)

%.shbin.o %_shbin.h : %.shlist
	@echo $(notdir $<)
	@$(call shader-as,$(foreach file,$(shell cat $<),$(dir $<)$(file)))

#---------------------------------------------------------------------------------
%.t3x	%.h	:	%.t3s
#---------------------------------------------------------------------------------
	@echo $(notdir $<)
	@tex3ds -i $< -H $*.h -d $*.d -o $(TOPDIR)/$(GFXBUILD)/$*.t3x

-include $(DEPSDIR)/*.d

#---------------------------------------------------------------------------------------
endif
#---------------------------------------------------------------------------------------
