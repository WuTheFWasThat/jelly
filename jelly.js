/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS104: Avoid inline assignments
 * DS202: Simplify dynamic range loops
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */

const CELL_SIZE = 48;

const moveToCell = function(dom, x, y) {
  dom.style.left = (x * CELL_SIZE) + 'px';
  return dom.style.top = (y * CELL_SIZE) + 'px';
};

const directions = {
  'left' : { x:-1, y: 0 },
  'right': { x: 1, y: 0 },
  'up'   : { x: 0, y:-1 },
  'down' : { x: 0, y: 1 },
};

const style_colors = {
  'black' : 'hsl(0,     0%,  0%)',
  'red'   : 'hsl(0,   100%, 75%)',
  'green' : 'hsl(120, 100%, 45%)',
  'blue'  : 'hsl(216, 100%, 70%)',
  'yellow': 'hsl(60,  100%, 50%)'
};

function parseColor(cellval) {
  switch (cellval) {
    case 'r': return 'red';
    case 'g': return 'green';
    case 'b': return 'blue';
    case 'y': return 'yellow';
    case '0':case '1':case '2':case '3':case '4':case '5':case '6':case '7':case '8':case '9':
      return `black${cellval}`;
  }
  throw new Error(`Unexpected cell val ${cellval}`);
}

function parseCellsFromMap(map) {
  const cells = [];
  const jellies = [];

  return map.map((row) => {
    return row.split('').map((x) => {
      let cell = null;
      if (x === 'x') {
        return new Wall();
      } else if (x !== ' ') {
        return new JellyCell(parseColor(x))
      } else {
        return null;
      }
    });
  });
}

class Stage {
  constructor(dom, map) {
    this.dom = dom;
    this.jellies = [];
    this.history = [];
    this.anchored_cells = [];
    this.growers = [];
    this.delayed_anchors = [];
    this.num_monochromatic_blocks = 0;
    this.num_colors = 0;
    this.loadMap(map.map);
    if (map.anchors) { this.placeAnchors(map.anchors, map.growers); }
    if (map.growers) { this.placeGrowers(map.growers); }
    this.current_cell = null;

    // Capture and swallow all click events during animations.
    this.busy = false;
    const maybeSwallowEvent = e => {
      e.preventDefault();
      if (this.busy) { return e.stopPropagation(); }
    };
    for (let event of ['contextmenu', 'click', 'touchstart', 'touchmove']) {
      this.dom.addEventListener(event, maybeSwallowEvent, true);
    }
    document.addEventListener('keydown', e => {
      if (this.busy) { return; }
      switch (e.keyCode) {
        case 37: return this.trySlide(this.current_cell, -1);
        case 39: return this.trySlide(this.current_cell, 1);
      }
    });

    this.checkForMerges();
  }

  loadMap(map) {
    const table = document.createElement('table');
    this.dom.appendChild(table);
    const colors = {};
    this.cells = (() => {
      const result = [];
      for (var y = 0, end = map.length, asc = 0 <= end; asc ? y < end : y > end; asc ? y++ : y--) {
        var row = map[y].split('');
        var tr = document.createElement('tr');
        table.appendChild(tr);
        result.push((() => {
          const result1 = [];
          for (let x = 0, end1 = row.length, asc1 = 0 <= end1; asc1 ? x < end1 : x > end1; asc1 ? x++ : x--) {
            let color = null;
            let classname = 'transparent';
            let cell = null;
            const td = document.createElement('td');
            switch (row[x]) {
              case 'x':
                classname = 'cell wall';
                cell = new Wall(td);
                break;
              case 'r': color = 'red'; break;
              case 'g': color = 'green'; break;
              case 'b': color = 'blue'; break;
              case 'y': color = 'yellow'; break;
              case '0':case '1':case '2':case '3':case '4':case '5':case '6':case '7':case '8':case '9':
                color = `black${row[x]}`;
                break;
            }
            td.className = classname;
            tr.appendChild(td);
            if (color) {
              cell = new JellyCell(color);
              const jelly = new Jelly(this, cell, x, y);
              this.dom.appendChild(jelly.dom);
              this.jellies.push(jelly);
              this.num_monochromatic_blocks += 1;
              if (!(color in colors)) { this.num_colors +=1; }
              colors[color] = 1;
            }
            result1.push(cell);
          }
          return result1;
        })());
      }
      return result;
    })();
    return this.addBorders();
  }

  placeAnchors(anchors, growers) {
    const style = {
      'left' : [ 'arrow leftarrow' , 'borderRightColor'  ],
      'right': [ 'arrow rightarrow', 'borderLeftColor'   ],
      'up'   : [ 'arrow uparrow'   , 'borderBottomColor' ],
      'down' : [ 'arrow downarrow' , 'borderTopColor'    ],
    };

    for (let anchor of Array.from(anchors)) {
      const dx = directions[anchor.dir].x;
      const dy = directions[anchor.dir].y;
      const classname = style[anchor.dir][0];
      const property = style[anchor.dir][1];

      const me = this.cells[anchor.y][anchor.x];
      const other = this.cells[anchor.y + dy][anchor.x + dx];
      let arrow_color = 'black';

      // We allow yet-to-be-grown jellies to be anchored in advance,
      // and we create the visual element, but there is nothing to anchor yet,
      // so we put it in a special place for future reference.
      if ((me === null) || (anchor.delayed)) {
        this.delayed_anchors.push([anchor, other]);

        // We use the growers array to figure out the color of the anchor.
        for (let grower of Array.from(growers)) {
          if ((grower.x === (anchor.x + dx)) && (grower.y === (anchor.y + dy))) {
            arrow_color = grower.color;
            break;
          }
        }
      } else {
        // Save the cells we anchored for undo functionality
        this.anchored_cells.push([me, anchor.dir]);
        arrow_color = me.color;
        me.mergeWith(other, anchor.dir);
      }

      // Create the overlapping anchoring triangle.
      const arrow = document.createElement('div');
      arrow.style[property] = style_colors[arrow_color];
      arrow.className = classname;
      this.addElement(arrow, other);
    }

    this.jellies = (Array.from(this.jellies).filter((jelly) => jelly.cells));
  }

  placeGrowers(growers) {
    const style = {
      'left' : [ 'grower leftgrower' , 'borderLeftColor'   ],
      'right': [ 'grower rightgrower', 'borderRightColor'  ],
      'up'   : [ 'grower upgrower'   , 'borderTopColor'    ],
    };

    for (let grower of Array.from(growers)) {
      const classname = style[grower.dir][0];
      const property = style[grower.dir][1];

      const me = this.cells[grower.y][grower.x];

      // Create the visual representation of a grower
      const grower_div = document.createElement('div');
      grower_div.style[property] = style_colors[grower.color];
      grower_div.className = classname;
      this.addElement(grower_div, me);

      this.growers.push([me, grower, grower_div]);

      // We treat each grower as a future block,
      // requiring it to be activated for level completion.
      this.num_monochromatic_blocks += 1;
    }

  }

  // Adds overlapping visual elements to the table;
  // given that now we can have both anchor and grower in the same cell,
  // and to fix the way firefox displays absolute div in td cell,
  // we don't add the elements to the dom directly, but make sure we have
  // a container div with position relative, and add our elements to it.
  addElement(element, cell) {
    if (cell.dom.firstChild) {
      cell.dom.firstChild.appendChild(element);
    } else {
      const div_container = document.createElement('div');
      div_container.style.position = 'relative';
      div_container.style.height = '100%';
      div_container.style.width = '100%';
      div_container.appendChild(element);
      cell.dom.appendChild(div_container);
    }
  }


  addBorders() {
    for (let y = 0, end = this.cells.length, asc = 0 <= end; asc ? y < end : y > end; asc ? y++ : y--) {
      for (let x = 0, end1 = this.cells[0].length, asc1 = 0 <= end1; asc1 ? x < end1 : x > end1; asc1 ? x++ : x--) {
        const cell = this.cells[y][x];
        if (!(cell instanceof Wall)) { continue; }
        const border = 'solid 1px #777';
        const edges = [
          ['borderBottom',  0,  1],
          ['borderTop',     0, -1],
          ['borderLeft',   -1,  0],
          ['borderRight',   1,  0],
        ];
        for (let [attr, dx, dy] of Array.from(edges)) {
          var middle, middle1;
          if (!(0 <= ((middle = y+dy)) && middle < this.cells.length)) { continue; }
          if (!(0 <= ((middle1 = x+dx)) && middle1 < this.cells[0].length)) { continue; }
          const other = this.cells[y+dy][x+dx];
          if (!(other instanceof Wall)) { cell.dom.style[attr] = border; }
        }
      }
    }
  }

  waitForAnimation(cb) {
    const names = ['transitionend', 'webkitTransitionEnd'];
    names.forEach((name) => {
      const end = () => {
        this.dom.removeEventListener(name, end);

        // Wait one call stack before continuing.  This is necessary if there
        // are multiple pending end transition events (multiple jellies moving);
        // we want to wait for them all here and not accidentally catch them
        // in a subsequent waitForAnimation.
        return setTimeout(cb, 0);
      };
      this.dom.addEventListener(name, end);
    });
  }

  trySlide(jelly, dir) {
    if (!jelly) { return; }
    const jellies = [jelly];
    if (this.checkFilled(jellies, dir, 0)) {
      return;
    }
    this.busy = true;
    this.saveForUndo();
    this.move(jellies, dir, 0);
    this.waitForAnimation(() => {
      return this.checkFall(() => {
        this.checkForMerges();
        return this.checkForGrows();
      });
    });
  }

  move(jellies, dx, dy) {
    let cell, x, y;
    for (var jelly of Array.from(jellies)) {
      for ([x, y, cell] of Array.from(jelly.cellCoords())) {
        this.cells[y][x] = null;
      }
    }
    for (jelly of Array.from(jellies)) {
      jelly.updatePosition(jelly.x+dx, jelly.y+dy);
    }
    for (jelly of Array.from(jellies)) {
      for ([x, y, cell] of Array.from(jelly.cellCoords())) {
        this.cells[y][x] = cell;
      }
    }
  }

  checkFilled(jellies, dx, dy) {
    let done = false;
    while (!done) {
      done = true;
      for (let jelly of Array.from(jellies)) {
        if (jelly.immovable) { return true; }
        for (let [x, y, cell] of Array.from(jelly.cellCoords())) {
          const next = this.cells[y + dy][x + dx];
          if (!next) { continue; }           // empty space
          if (!next.jelly) { return true; }  // wall
          if (Array.from(jellies).includes(next.jelly)) { continue; }
          jellies.push(next.jelly);
          done = false;
          break;
        }
      }
    }
    return false;
  }

  checkFall(cb) {
    let moved = false;
    let try_again = true;
    while (try_again) {
      try_again = false;
      for (let jelly of Array.from(this.jellies)) {
        const jellyset = [jelly];
        if (!this.checkFilled(jellyset, 0, 1)) {
          this.move(jellyset, 0, 1);
          try_again = true;
          moved = true;
        }
      }
    }
    if (moved) {
      this.waitForAnimation(cb);
    } else {
      cb();
    }
  }

  checkForMerges() {
    let merged = false;
    while (this.doOneMerge()) {
      merged = true;
    }
    if (merged) { this.checkForCompletion(); }
  }

  checkForCompletion() {
    if (this.num_monochromatic_blocks <= this.num_colors) {
      alert("Congratulations! Level completed.");
    }
  }

  checkForGrows() {
    if (this.doOneGrow()) {
      setTimeout(() => {
        return this.checkForGrows();
      }, 200);
    } else {
      this.busy = false;
    }
  }

  doOneGrow() {
    let jelly;
    for (let [cell, grower, grower_div] of Array.from(this.growers)) {
      var new_x, new_y;
      var i = (i+1) || 0;
      let dx = directions[grower.dir].x;
      let dy = directions[grower.dir].y;
      if (cell instanceof Wall) {
        new_y = grower.y + dy;
        new_x = grower.x + dx;
      } else {
        new_y = cell.y + cell.jelly.y + dy;
        new_x = cell.x + cell.jelly.x + dx;
      }
      const activator = this.cells[new_y][new_x];

      if (!(activator instanceof JellyCell)) { continue; }
      if (activator.color !== grower.color) { continue; }
      let jellies = [activator.jelly];
      if (this.checkFilled(jellies, dx, dy)) {
        if (cell instanceof Wall) { continue; }
        // If our grower is not inside a wall, we can activate the jelly
        // not only by moving the activator away from it, but the other way
        // around, by moving the jelly with the grower away (level 31).
        dx = -dx;
        dy = -dy;
        jellies = [activator.jelly];
        if (this.checkFilled(jellies, dx, dy)) { continue; }
        // Remove the activator itself from the list.
        jellies.splice(0,1);
        new_x += dx;
        new_y += dy;
      }

      this.move(jellies, dx, dy);
      const new_cell = new JellyCell(grower.color);
      jelly = new Jelly(this, new_cell, new_x, new_y);
      this.cells[new_y][new_x] = new_cell;
      this.dom.appendChild(jelly.dom);
      this.jellies.push(jelly);
      this.growers.splice(i, 1);
      cell.dom.firstChild.removeChild(grower_div);

      this.checkGrownAnchored(new_cell);

      this.jellies = ((() => {
        const result = [];
        for (jelly of Array.from(this.jellies)) {           if (jelly.cells) {
            result.push(jelly);
          }
        }
        return result;
      })());
      this.checkForMerges();
      return true;
    }
    return false;
  }

  checkGrownAnchored(cell) {
    for (let [anchor, other] of Array.from(this.delayed_anchors)) {
      var check_x, check_y;
      var i = (i+1) || 0;

      if (other instanceof Wall) {
        check_x = anchor.x;
        check_y = anchor.y;
      } else {
        check_x = (other.x + other.jelly.x) - directions[anchor.dir].x;
        check_y = (other.y + other.jelly.y) - directions[anchor.dir].y;
      }

      if ((check_x === (cell.x + cell.jelly.x)) &&
         (check_y === (cell.y + cell.jelly.y))) {
        cell.mergeWith(other, anchor.dir);
        this.delayed_anchors.splice(i, 1);
        this.anchored_cells.push([cell, anchor.dir]);
        break;
      }
    }
  }

  doOneMerge() {
    for (let jelly of Array.from(this.jellies)) {
      for (let [x, y, cell] of Array.from(jelly.cellCoords())) {
        // Only look right and down; left and up are handled by that side
        // itself looking right and down.
        for (let [dx, dy, dir] of [[1, 0, 'right'], [0, 1, 'down']]) {
          var other = this.cells[y + dy][x + dx];
          if (!other || !(other instanceof JellyCell)) { continue; }
          if (cell[`merged${dir}`]) { continue; }
          if (other.color !== cell.color) { continue; }
          if (jelly !== other.jelly) {
            this.jellies = this.jellies.filter(j => j !== other.jelly);
          }
          if (cell.color_master !== other.color_master) {
            this.num_monochromatic_blocks -= 1;
          }
          cell.mergeWith(other, dir);
          cell[`merged${dir}`] = true;
          return true;
        }
      }
    }
    return false;
  }

  // Undo functionality is implemented via deconstruction of the available
  // data structures to get the initial configuration as listed in [levels].
  saveForUndo() {
    const map     = this.saveForUndoMap();
    const anchors = this.saveForUndoAnchors();
    const growers = this.saveForUndoGrowers();

    this.history.push([map, anchors, growers]);
  }


  saveForUndoMap() {
    const map = [];
    // We run over all the cells and revert it to
    // the original textual representation.
    for (let y = 0, end = this.cells.length, asc = 0 <= end; asc ? y < end : y > end; asc ? y++ : y--) {
      let row = "";
      for (let x = 0, end1 = this.cells[0].length, asc1 = 0 <= end1; asc1 ? x < end1 : x > end1; asc1 ? x++ : x--) {
        const cell = this.cells[y][x];
        if (cell instanceof Wall) { row += "x"; }
        if (cell === null) { row += " "; }
        if (cell instanceof JellyCell) {
          switch (cell.color) {
            case "red": row += "r"; break;
            case "green": row += "g"; break;
            case "blue": row += "b"; break;
            case "yellow": row += "y"; break;
            case "black0":case "black1":case "black2":case "black3":case "black4":case "black5":case "black6":case "black7":case "black8":case "black9":
              row += cell.color.slice(5);
              break;
          }
        }
      }
      map.push(row);
    }
    return map;
  }

  saveForUndoAnchors() {
    let anchor, other;
    const anchors = [];
    // Add anchors from the cells they were attached to
    for (let [anchored_cell, direction] of Array.from(this.anchored_cells)) {
      anchor = {
        'x': anchored_cell.x + anchored_cell.jelly.x,
        'y': anchored_cell.y + anchored_cell.jelly.y,
        'dir': direction
      };
      anchors.push(anchor);
    }

    // Add delayed anchors that aren't attached yet
    for ([anchor, other] of Array.from(this.delayed_anchors)) {
      let new_anchor = anchor;
      if (!(other instanceof Wall)) {
        new_anchor = {
          'x': (other.x + other.jelly.x) - directions[anchor.dir].x,
          'y': (other.y + other.jelly.y) - directions[anchor.dir].y,
          'dir': anchor.dir
        };
      }
      new_anchor.delayed = true;
      anchors.push(new_anchor);
    }
    return anchors;
  }

  saveForUndoGrowers() {
    const growers = [];
    // Add growers that weren't activated yet,
    // otherwise they are simple cells already listed
    for (let [cell, grower, grower_div] of Array.from(this.growers)) {
      let new_y = grower.y;
      let new_x = grower.x;
      if (!(cell instanceof Wall)) {
        new_y = cell.y + cell.jelly.y;
        new_x = cell.x + cell.jelly.x;
      }
      const new_grower = {
        'x':new_x,
        'y':new_y,
        'dir':grower.dir,
        'color':grower.color
      };
      growers.push(new_grower);
    }
    return growers;
  }
}

class Wall {
  constructor(dom) {
    this.dom = dom;
  }
}

class JellyCell {
  constructor(color) {
    this.color = color;
    this.dom = document.createElement('div');
    this.dom.className = `cell jelly ${color}`;
    this.x = 0;
    this.y = 0;
    this.color_master = this;
    this.color_mates = [this];
  }

  mergeWith(other, dir) {
    const borders = {
      'left':  ['borderLeft',   'borderRight'],
      'right': ['borderRight',  'borderLeft'],
      'up':    ['borderTop',    'borderBottom'],
      'down':  ['borderBottom', 'borderTop']
    };
    // Remove internal borders, whether merging with other jelly or wall.
    this.dom.style[borders[dir][0]] = 'none';
    other.dom.style[borders[dir][1]] = 'none';

    // If merging with wall, jelly becomes immovable.
    if (other instanceof Wall) { this.jelly.immovable = true; }

    // If merging with jelly, unify the jellies and color mates' lists.
    if (other instanceof JellyCell && (this.color === other.color) && (this.color_master !== other.color_master)) {
      const other_master = other.color_master;
      for (let cell of Array.from(other_master.color_mates)) {
        cell.color_master = this.color_master;
      }
      this.color_master.color_mates =
        this.color_master.color_mates.concat(other_master.color_mates);
    }
    if (other instanceof JellyCell && (this.jelly !== other.jelly)) {
      return this.jelly.merge(other.jelly);
    }
  }
}

class Jelly {
  constructor(stage, cell, x, y) {
    this.x = x;
    this.y = y;
    this.dom = document.createElement('div');
    this.updatePosition(this.x, this.y);
    this.dom.className = 'cell jellybox';
    cell.jelly = this;
    this.cells = [cell];
    this.dom.appendChild(cell.dom);

    this.dom.addEventListener('contextmenu', e => {
      stage.trySlide(this, 1);
    });
    this.dom.addEventListener('click', e => {
      stage.trySlide(this, -1);
    });

    this.dom.addEventListener('touchstart', e => {
      return this.start = e.touches[0].pageX;
    });
    this.dom.addEventListener('touchmove', e => {
      const dx = e.touches[0].pageX - this.start;
      if (Math.abs(dx) > 10) {
        let left;
        const dir = (left = dx > 0) != null ? left : {1 : -1};
        stage.trySlide(this, dir);
      }
    });
    this.dom.addEventListener('mouseover', e => {
      return stage.current_cell = this;
    });
    this.immovable = false;
  }

  cellCoords() {
    return Array.from(this.cells).map((cell) => [this.x + cell.x, this.y + cell.y, cell]);
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
    return moveToCell(this.dom, this.x, this.y);
  }

  merge(other) {
    // Reposition other's cells as children of this jelly.
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    for (let cell of Array.from(other.cells)) {
      this.cells.push(cell);
      cell.x += dx;
      cell.y += dy;
      cell.jelly = this;
      moveToCell(cell.dom, cell.x, cell.y);
      this.dom.appendChild(cell.dom);
    }

    if (other.immovable) { this.immovable = true; }
    // Delete references from/to other.
    other.cells = null;
    other.dom.parentNode.removeChild(other.dom);
  }
}

const levels = [
  { // Level 1
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x            x",
      "x      r     x",
      "x      xx    x",
      "x  g     r b x",
      "xxbxxxg xxxxxx",
      "xxxxxxxxxxxxxx",
    ],
  },

  { // Level 2
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x            x",
      "x            x",
      "x     g   g  x",
      "x   r r   r  x",
      "xxxxx x x xxxx",
      "xxxxxxxxxxxxxx",
    ],
  },

  { // Level 3
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x            x",
      "x   bg  x g  x",
      "xxx xxxrxxx  x",
      "x      b     x",
      "xxx xxxrxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
  },

  { // Level 4
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x       r    x",
      "x       b    x",
      "x       x    x",
      "x b r        x",
      "x b r      b x",
      "xxx x      xxx",
      "xxxxx xxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
  },

  { // Level 5
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x            x",
      "xrg  gg      x",
      "xxx xxxx xx  x",
      "xrg          x",
      "xxxxx  xx   xx",
      "xxxxxx xx  xxx",
      "xxxxxxxxxxxxxx",
    ],
  },

  { // Level 6
    map: [
      "xxxxxxxxxxxxxx",
      "xxxxxxx      x",
      "xxxxxxx g    x",
      "x       xx   x",
      "x r   b      x",
      "x x xxx x g  x",
      "x         x bx",
      "x       r xxxx",
      "x   xxxxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
  },

  // Anchored jellies are specified separately after the
  // level map. Instead of [row, row, row...in the presence of
  // anchors the level specification is:
  // [ [row,row,row...], [ anchor, anchor, anchor...] ].
  // Each anchor starts from a colored non-black jelly's
  // coordinates and specifies the direction in which it's "held".
  { // Level 7
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x          r x",
      "x          x x",
      "x     b   b  x",
      "x     x  rr  x",
      "x         x  x",
      "x r  bx x x  x",
      "x x  xx x x  x",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:2, y:7, dir:'down' },
      { x:5, y:7, dir:'down' },
    ],
  },

  { // Level 8
    map: [
      "xxxxxxxxxxxxxx",
      "xxxx x  x xxxx",
      "xxx  g  b  xxx",
      "xx   x  x   xx",
      "xx   b  g   xx",
      "xxg        bxx",
      "xxxg      bxxx",
      "xxxx      xxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:5, y:4, dir:'up' },
      { x:8, y:4, dir:'up' },
    ]
  },

  { // Level 9
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x            x",
      "x          rbx",
      "x    x     xxx",
      "xb        00xx",
      "xx  rx  x xxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:4, y:6, dir:'down' },
    ],
  },

  { // Level 10
    map: [
      "xxxxxxxxxxxxxx",
      "x   gr       x",
      "x   00 1     x",
      "x    x x xxxxx",
      "x            x",
      "x  x  x      x",
      "x        x  rx",
      "xx   x     gxx",
      "x          xxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:11, y:7, dir:'down' },
      { x:12, y:6, dir:'down' },
    ],
  },

  { // Level 11
    map: [
      "xxxxxxxxxxxxxx",
      "x      g00g gx",
      "x       xxx xx",
      "x           gx",
      "x11         xx",
      "xxx          x",
      "x       g    x",
      "x   x xxx   gx",
      "x   xxxxxx xxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:12, y:7, dir:'down' },
      { x:7, y:1, dir:'right' },
      { x:10, y:1, dir:'left' },
    ],
  },

  { // Level 12
    map: [
      "xxxxxxxxxxxxxx",
      "xxr rr  rr rxx",
      "xxx  x  x  xxx",
      "x            x",
      "xb          bx",
      "xx          xx",
      "x            x",
      "x            x",
      "x   xxxxxx   x",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:12, y:4, dir:'down' },
    ],
  },

  { // Level 13
    map: [
      "xxxxxxxxxxxxxx",
      "xxxxxxxxxxxxxx",
      "xxxxx gr xxxxx",
      "xxxxx rb xxxxx",
      "xxxxx gr xxxxx",
      "xxxxx bg xxxxx",
      "xxxxxxxxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
  },

  { // Level 14
    map: [
      "xxxxxxxxxxxxxx",
      "xxxxxxxxx   rx",
      "xxxxxxxxx   gx",
      "xxxxxxxxx   gx",
      "x1122       gx",
      "x1122       gx",
      "x0033      xxx",
      "x0033      xxx",
      "xxr x gxxx xxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:2, y:8, dir:'down' },
      { x:6, y:8, dir:'down' },
    ],
  },

  { // Level 15
    map: [
      "xxxxxxxxxxxxxx",
      "xr r r      rx",
      "xg x x      gx",
      "xb          bx",
      "xxxxx     xxxx",
      "xxxxxx   xxxxx",
      "xxxxxx   xxxxx",
      "xxxxxx   xxxxx",
      "xxxxxxgggxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:1, y:3, dir:'down' },
      { x:6, y:8, dir:'left' },
      { x:8, y:8, dir:'right' },
    ],
  },

  { // Level 16
    map: [
      "xxxxxxxxxxxxxx",
      "xx   0001233rx",
      "xx   0411233xx",
      "xx   444122xxx",
      "xx     xxxxxxx",
      "xr     xxxxxxx",
      "xx     xxxxxxx",
      "xx     xxxxxxx",
      "xx     xxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:1, y:5, dir:'up' },
    ],
  },

  { // Level 17
    map: [
      "xxxxxxxxxxxxxx",
      "xxxx000xxxgb x",
      "xxxx0     bg x",
      "xxxx0    11xxx",
      "xxxx000xxxxxxx",
      "x 222  xxxxxxx",
      "xxxx     xxgxx",
      "xxxx   g    bx",
      "xxxx   x     x",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:11, y:6, dir:'up' },
      { x:12, y:7, dir:'up' },
    ],
  },

  { // Level 18
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "xb01         x",
      "xb0gg     g  x",
      "xb023     g4bx",
      "xxxxx g   xxxx",
      "xxxxx gg  xxxx",
      "xxxxx ggg xxxx",
      "xxxxx ggggxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:12, y:4, dir:'down' },
    ],
  },

  { // Level 19
    map: [
      "xxxxxxxxxxxxxx",
      "xg0    g1gx  x",
      "x 3g    1 x  x",
      "x444    2 x  x",
      "xg g   ggg   x",
      "xxx     xxx  x",
      "xxx     xxx  x",
      "xxx     xxx  x",
      "xxx          x",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:1, y:1, dir:'right' },
      { x:3, y:2, dir:'left' },
      { x:1, y:4, dir:'up' },
      { x:3, y:4, dir:'up' },
      { x:8, y:4, dir:'up' },
      { x:7, y:1, dir:'right' },
      { x:9, y:1, dir:'left' },
    ],
  },

  { // Level 20
    map: [
      "xxxxxxxxxxxxxx",
      "xrrrr   rggxxx",
      "xxxb    xxxxxx",
      "xxxx       xbx",
      "xx           x",
      "xx           x",
      "xx     x     x",
      "xx x         x",
      "xx        x  x",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:12, y:3, dir:'up' },
    ],
  },

  // "Growers" are a new type of jelly that need to be
  // interacted with before they appear on the map.
  // A jelly of the same color needs to come in contact
  // with the "grower" spawning a new jelly in the given
  // direction, and pushing the old one.
  // "No touching! No touching!"
  // We use a format similar to anchored jellies and
  // specify coordinates, direction and color of the new spawn.
  { // Level 21
    map: [
      "xxxxxxxxxxxxxx",
      "x      x     x",
      "x      x     x",
      "x      x     x",
      "x      g     x",
      "x        gb  x",
      "xxxx     xx  x",
      "xxxr b     r x",
      "xxxx xxxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:7, y:4, dir:'up' },
    ],
    growers: [
      { x:7, y:8, dir:'up', color:'red' },
    ],
  },

  { // Level 22
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x            x",
      "x            x",
      "x            x",
      "x    g  bgr  x",
      "x x xx  xxx xx",
      "xbx          x",
      "xxxxxxxxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:6, y:7, dir:'down' },
    ],
    growers: [
      { x:6, y:8, dir:'up', color:'red' },
    ],
  },

  { // Level 23
    map: [
      "xxxxxxxxxxxxxx",
      "x            x",
      "x            x",
      "x    g       x",
      "x    b       x",
      "x    x    r  x",
      "x        xx  x",
      "x b          x",
      "xxxx r xxx xgx",
      "xxxxxxxxxxxxxx",
    ],
    growers: [
      { x:8, y:8, dir:'up', color:'red' },
    ],
  },

  { // Level 24
    map: [
      "xxxxxxxxxxxxxx",
      "xg   b     xxx",
      "xr   g     xxx",
      "xy   b y   yxx",
      "xx   x x   xxx",
      "xxxx       xxx",
      "xxxx       xxx",
      "xxxxxx xxxxxxx",
      "xxxxxxgxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:1, y:3, dir:'down' },
      { x:6, y:8, dir:'down' },
      { x:9, y:6, dir:'down' },
    ],
    growers: [
      { x:4, y:7, dir:'up', color:'green' },
      { x:9, y:7, dir:'up', color:'red' },
    ],
  },

  { // Level 25
    map: [
      "xxxxxxxxxxxxxx",
      "xxxxxxxx  x  x",
      "xxxxxxxx  r  x",
      "xxxxxxxx     x",
      "xxxxx     r  x",
      "xx111    222 x",
      "x 111    222 x",
      "x g        x x",
      "xxxxxxxxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:10, y:2, dir:'up' },
    ],
    growers: [
      { x:4, y:8, dir:'up', color:'green' },
      { x:7, y:8, dir:'up', color:'green' },
      { x:10, y:8, dir:'up', color:'green' },
    ],
  },

  { // Level 26
    map: [
      "xxxxxxxxxxxxxx",
      "xx        xxxx",
      "xx  r     xxxx",
      "xx11111111xxxx",
      "xx     r   xxx",
      "xx22222222 xxx",
      "xx  r      xxx",
      "xx33333333xxxx",
      "xx     r  xxxx",
      "xxxxxxxxxxxxxx",
    ],
    growers: [
      { x:7, y:3, dir:'up', color:'red' },
      { x:4, y:5, dir:'up', color:'red' },
      { x:7, y:7, dir:'up', color:'red' },
      { x:4, y:9, dir:'up', color:'red' },
    ],
  },

  { // Level 27
    map: [
      "xxxxxxxxxxxxxx",
      "xxxxxgxyxrxxxx",
      "xxxxx     xxxx",
      "xbyg2     r  x",
      "xxxxx     xx x",
      "xxxxx11111xx x",
      "xxxxx11111 x x",
      "xxxx 11111bx x",
      "xxxx   b     x",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:5, y:1, dir:'up' },
      { x:7, y:1, dir:'up' },
      { x:9, y:1, dir:'up' },
      { x:10, y:7, dir:'left' },
    ],
    growers: [
      { x:6, y:9, dir:'up', color:'blue' },
      { x:8, y:9, dir:'up', color:'blue' },
    ],
  },

  { // Level 28
    map: [
      "xxxxxxxxxxxxxx",
      "xxxx x  x xxxx",
      "xxx gb  gb xxx",
      "xx  xx  xx  xx",
      "xx   b  g   xx",
      "xx          xx",
      "xxx        xxx",
      "xxxxg    bxxxx",
      "xxxxxxxxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:5, y:4, dir:'up' },
      { x:8, y:4, dir:'up' },
      { x:5, y:7, dir:'down' },
      { x:8, y:7, dir:'down' },
    ],
    growers: [
      { x:5, y:8, dir:'up', color:'blue' },
      { x:8, y:8, dir:'up', color:'green' },
    ],
  },

  { // Level 29
    map: [
      "xxxxxxxxxxxxxx",
      "xxxx yyrr xxxx",
      "xxxx yyrr xxxx",
      "xxx  bbgg  xxx",
      "xxx  bbgg  xxx",
      "xxx  ggbb  xxx",
      "xxx  ggbb  xxx",
      "xxxx rryy xxxx",
      "xxxx rryy xxxx",
      "xxxxxxxxxxxxxx"
    ],
  },

  { // Level 30
    map: [
      "xxxxxxxxxxxxxx",
      "xr    xxxxxxxx",
      "xxx        xxx",
      "xxxx       xxx",
      "xxxx       xxx",
      "xxxx       xxx",
      "xxxx       xxx",
      "xrrr       xxx",
      "xxr        bxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:1, y:1, dir:'up' },
    ],
    growers: [
      { x:5, y:9, dir:'up', color:'blue' },
      { x:6, y:9, dir:'up', color:'blue' },
      { x:7, y:9, dir:'up', color:'blue' },
      { x:8, y:9, dir:'up', color:'blue' },
      { x:9, y:9, dir:'up', color:'blue' },
      { x:10, y:9, dir:'up', color:'blue' },
      { x:11, y:7, dir:'left', color:'blue' },
      { x:11, y:6, dir:'left', color:'blue' },
      { x:11, y:5, dir:'left', color:'blue' },
      { x:11, y:4, dir:'left', color:'blue' },
      { x:11, y:3, dir:'left', color:'blue' },
      { x:11, y:2, dir:'left', color:'blue' },
    ],
  },

  { // Level 31
    map: [
      "xxxxxxxxxxxxxx",
      "xxb xxxxxx bxx",
      "xxx  r  r  xxx",
      "xx   xxxx   xx",
      "xx xxxxxxxx xx",
      "x g   xx   g x",
      "xx11      22xx",
      "xx11      22xx",
      "xxxxxr  rxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:5, y:8, dir:'down' },
      { x:8, y:8, dir:'down' },
      { x:4, y:6, dir:'left' },
      { x:9, y:6, dir:'right' },
    ],
    growers: [
      { x:3, y:6, dir:'right', color:'green' },
      { x:10, y:6, dir:'left', color:'green' },
      { x:2, y:2, dir:'right', color:'blue' },
      { x:11, y:2, dir:'left', color:'blue' },
    ],
  },

  { // Level 32
    map: [
      "xxxxxxxxxxxxxx",
      "xg   y   xr0bx",
      "x1   2    y3gx",
      "xb   r44    xx",
      "xx   xxx   xxx",
      "x           xx",
      "x       xx  xx",
      "xx          xx",
      "xxx        xxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:1, y:1, dir:'down' },
      { x:1, y:3, dir:'up' },
      { x:5, y:1, dir:'down' },
      { x:5, y:3, dir:'up' },
      { x:10, y:1, dir:'right' },
      { x:12, y:1, dir:'left' },
      { x:10, y:2, dir:'right' },
      { x:12, y:2, dir:'left' },
    ],
  },

  { // Level 33
    map: [
      "xxxxxxxxxxxxxx",
      "xx1144    xxxx",
      "xr1224    xxxx",
      "xx3225    xxxx",
      "xx3355    xxxx",
      "xxxxxx    xxrx",
      "xx           x",
      "xxx          x",
      "xx     xx  x x",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:12, y:5, dir:'up' },
    ],
    growers: [
      { x:1, y:6, dir:'right', color:'red' },
    ],
  },

  { // Level 34
    map: [
      "xxxxxxxxxxxxxx",
      "xb      r12rxx",
      "xx      1122 x",
      "xx      3344xx",
      "x       r34rxx",
      "x       xxxxxx",
      "xx     gxxxxxx",
      "xx     xxxxxxx",
      "xx     xxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:1, y:4, dir:'left' },
      { x:8, y:1, dir:'right' },
      { x:8, y:1, dir:'down' },
      { x:11, y:1, dir:'left' },
      { x:11, y:1, dir:'down' },
      { x:8, y:4, dir:'right' },
      { x:8, y:4, dir:'up' },
      { x:11, y:4, dir:'left' },
      { x:11, y:4, dir:'up' },
    ],
    growers: [
      { x:0, y:4, dir:'right', color:'blue' },
      { x:13, y:2, dir:'left', color:'blue' },
      { x:4, y:9, dir:'up', color:'green' },
    ],
  },

  { // Level 35
    map: [
      "xxxxxxxxxxxxxx",
      "x00    bbbbbrx",
      "x0b        byx",
      "x00        byx",
      "xxxyyy     byx",
      "xxr1b1     xxx",
      "xx 111     xxx",
      "xxxxx      xxx",
      "xxxxxxxx   xxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:2, y:2, dir:'left' },
      { x:2, y:2, dir:'up' },
      { x:2, y:2, dir:'down' },
      { x:2, y:5, dir:'up' },
      { x:4, y:5, dir:'down' },
      { x:4, y:5, dir:'left' },
      { x:4, y:5, dir:'right' },
    ],
  },

  { // Level 36
    map: [
      "xxxxxxxxxxxxxx",
      "x    brgrbg  x",
      "x  xx111111xxx",
      "x  xx1y11r1xxx",
      "x    111122  x",
      "x    112222  x",
      "x    222222  x",
      "x    222222  x",
      "x    222222  x",
      "xxxxxxxxxxxxxx",
    ],
    growers: [
      { x:4, y:9, dir:'up', color:'red' },
    ],
  },

  { // Level 37
    map: [
      "xxxxxxxxxxxxxx",
      "xrr  rrr  rryx",
      "xxx    x   xxx",
      "x           gx",
      "x  rrr    rrrx",
      "xx  1        x",
      "xxx 1        x",
      "xx  1        x",
      "xxx 1       xx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:12, y:4, dir:'right' },
    ],
    growers: [
      { x:0, y:3, dir:'right', color:'yellow' },
      { x:0, y:4, dir:'right', color:'green' },
    ],
  },

  { // Level 38
    map: [
      "xxxxxxxxxxxxxx",
      "xgggxxybr    x",
      "x   xxbyb    x",
      "xgggxxxxxxx  x",
      "x111xx       x",
      "xx1xxx       x",
      "xx      xx xxx",
      "xx       xxxxx",
      "xxxxx xxxxxxxx",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:1, y:1, dir:'up' },
      { x:2, y:1, dir:'up' },
      { x:3, y:1, dir:'up' },
      { x:1, y:3, dir:'down' },
      { x:2, y:3, dir:'down' },
      { x:3, y:3, dir:'down' },
    ],
    growers: [
      { x:2, y:8, dir:'up', color:'red' },
    ],
  },

  { // Level 39
    map: [
      "xxxxxxxxxxxxxx",
      "xxxxx    xxxxx",
      "xxxx  1111xxxx",
      "xxxxx    xxxxx",
      "xxrx      xgxx",
      "xxb        bxx",
      "xyr        gyx",
      "xxxx      xxxx",
      "xxxxx xx xxxxx",
      "xxxxxxxxxxxxxx",
    ],
    growers: [
      { x:3, y:7, dir:'up', color:'green' },
      { x:10, y:7, dir:'up', color:'red' },
    ],
  },

  { // Level 40
    map: [
      "xxxxxxxxxxxxxx",
      "x      r r r x",
      "xx1yxxxx x x x",
      "xx11r  x x r x",
      "xxry y x x x x",
      "xx22 x x x r x",
      "xx22       x x",
      "xx2          x",
      "xxxx     x   x",
      "xxxxxxxxxxxxxx",
    ],
    anchors: [
      { x:4, y:3, dir:'up' },
    ],
    growers: [
      { x:3, y:8, dir:'up', color:'yellow' },
    ],
  },
];


const level = parseInt(location.search.substr(1), 10) || 1;
let stage = new Stage(document.getElementById('map'), levels[level-1]);
window.stage = stage;

const levelPicker = document.getElementById('level');
for (let i = 1, end = levels.length, asc = 1 <= end; asc ? i <= end : i >= end; asc ? i++ : i--) {
  const option = document.createElement('option');
  option.value = i;
  option.appendChild(document.createTextNode(`Level ${i}`));
  levelPicker.appendChild(option);
}
levelPicker.value = level;
levelPicker.addEventListener('change', () => location.search = `?${levelPicker.value}`);

document.getElementById('reset').addEventListener('click', function() {
  stage.dom.innerHTML = '';
  return stage = new Stage(stage.dom, levels[level-1]);
});

document.getElementById('undo').addEventListener('click', function() {
  if (stage.busy) { return; }
  const { history } = stage;
  if (!(history[0] instanceof Array)) { return; }
  stage.dom.innerHTML = '';
  stage = new Stage(stage.dom, history.pop());
  return stage.history = history;
});
