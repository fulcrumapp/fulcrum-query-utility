$(document).ready(function() {
  app.init();
  app.authModule.init();
  app.mapModule.init();
  app.queryModule.init();
});

var app = {

  editor: null,
  currentFields: null,
  currentRows: null,
  currentGeometryColumn: null,

  init: function() {
    this.bindUIActions();
    this.buildEditor();
    app.authModule.checkLogin();
  },

  bindUIActions: function() {
    $("#about-btn").click(function() {
      $("#aboutModal").modal("show");
      $(".navbar-collapse.in").collapse("hide");
      return false;
    });

    $(window).resize(function() {
      $("#table").bootstrapTable("resetView", {
        height: $(window).height() - 70
      });
    });
  },

  buildEditor: function() {
    app.editor = CodeMirror.fromTextArea($("#query")[0], {
      mode: "text/x-sql",
      lineNumbers: true,
      lineWrapping: true,
      viewportMargin: Infinity
    });

    app.editor.on("change", function(cm, change) {
      sessionStorage.setItem("fulcrum_query_value", cm.getValue());
    });
  },

  authModule: {
    init: function() {
      this.bindUIActions();
    },

    setupSession: function (token) {
      sessionStorage.setItem("fulcrum_query_token", btoa(token));
      app.editor.getDoc().setValue("SELECT * FROM tables;");
      $("#saved-queries-select").val("SELECT * FROM tables;");
      app.queryModule.executeQuery(1, {});
      app.queryModule.fetchQueries();
      $("#loginModal").modal("hide");
      $("#logout-btn").removeClass("hide");
    },

    bindUIActions: function() {
      function validateCredentials () {
        var $email = $("#email");
        var $password = $("#password");

        $email.val($email.val().trim());
        $password.val($password.val().trim());

        if (!($email.val().length && $password.val().length)) {
          alert('Please enter email and password');
        } else {
          app.authModule.login();
        }
        return false;
      }

      function validateToken () {
        var token = $("#token").val().trim();

        $.ajax({
          type: "GET",
          url: "https://api.fulcrumapp.com/api/v2/forms.json?page=1&per_page=1&schema=false",
          contentType: "application/json",
          dataType: "json",
          headers: {
            "X-ApiToken": token
          },
          statusCode: {
            401: function() {
              alert("Invalid token, please try again.");
            }
          },
          success: function(data) {
            app.authModule.setupSession(token);
          }
        });

        return false;
      }

      $("#login-btn").click(validateCredentials);

      $(".login-form").on('submit', validateCredentials);

      $(".token-form").on('submit', validateToken);

      $("#logout-btn").click(function() {
        app.authModule.logout();
        return false;
      });
    },

    checkLogin: function() {
      if (!sessionStorage.getItem("fulcrum_query_token")) {
        $("#loginModal").modal("show");
        $(".modal-backdrop").css("opacity", "1");
      } else {
        $("#logout-btn").removeClass("hide");
        $("#loginModal").modal("hide");
        $(".modal-backdrop").css("opacity", "0.5");
        app.queryModule.fetchQueries();
        app.queryModule.initialQuery();
      }
    },

    login: function() {
      var username = $("#email").val();
      var password = $("#password").val();
      $.ajax({
        type: "GET",
        url: "https://api.fulcrumapp.com/api/v2/users.json",
        contentType: "application/json",
        dataType: "json",
        headers: {
          "Authorization": "Basic " + btoa(username + ":" + password)
        },
        statusCode: {
          401: function() {
            alert("Incorrect credentials, please try again.");
          }
        },
        success: function(data) {
          $orgSelect = $("#context-select");
          contexts = $(data.user.contexts).sort(function(a, b) {
            return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1;
          });
          contexts.each(function (i, context) {
            $orgSelect.append($("<option></option>")
                              .attr("value", context.id)
                              .prop("disabled", (context.role.can_manage_authorizations ? false : true))
                              .text(context.name + (context.role.can_manage_authorizations ? "" : " (role does not have ability to manage API tokens)")));
          });
          $(".login-form :input").attr("disabled", "disabled");
          $(".org-picker-form").show();
        }
      });
    },

    logout: function() {
      sessionStorage.removeItem("fulcrum_query_token");
      location.reload();
    }
  },

  mapModule: {
    init: function() {
      this.buildMap();
      this.bindUIActions();
    },

    bindUIActions: function() {
      $("#map-btn").click(function() {
        if (app.currentRows && app.currentGeometryColumn) {
          $("#mapModal").on("shown.bs.modal", function() {
            app.mapModule.map.invalidateSize();
            app.mapModule.mapData();
          });
          $("#mapModal").modal("show");
        } else {
          alert("Table must include geometry column!");
        }
        $(".navbar-collapse.in").collapse("hide");
        return false;
      });
    },

    points: L.geoJson(null, {
      pointToLayer: function(feature, latlng) {
        return L.marker(latlng, {
          icon: L.icon({
            iconUrl: "assets/img/map-marker.png",
            iconSize: [30, 40],
            iconAnchor: [15, 32],
            popupAnchor: [0, -29]
          }),
          title: feature.properties._title ? feature.properties._title : "",
          riseOnHover: true
        });
      },
      onEachFeature: function(feature, layer) {
        if (feature.properties) {
          delete feature.properties.state;
          var attributes = [];
          $.each(feature.properties, function(index, property) {
            if (!property) {
              property = "";
            }
            if (typeof property == "string" && (JSON.stringify(property).indexOf("http") === true || JSON.stringify(property).indexOf("https") === true)) {
              property = "<a href='" + property + "' target='_blank'>" + property + "</a>";
            }
            attributes.push("<strong>" + index + "</strong>: " + property);
          });
          layer.bindPopup(attributes.join("<br>"), {
            maxHeight: 200,
            maxWidth: $("#map").width() / 2
          });
        }
      }
    }),

    basemap: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.@2xpng", {
      attribution: '© <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attribution">CARTO</a>',
    }),

    buildMap: function() {
      app.mapModule.map = L.map("map", {
        layers: [app.mapModule.basemap, app.mapModule.points]
      }).fitWorld();
    },

    mapData: function() {
      var features = [];

      app.currentRows.forEach(function(row) {
        if (row[app.currentGeometryColumn]) {
          var properties = Object.assign({}, row);

          features.push({
            "type": "Feature",
            "properties": properties,
            "geometry": row[app.currentGeometryColumn]
          });
        }
      });

      var geojson = {
        "type": "FeatureCollection",
        "features": features
      };

      app.mapModule.points.clearLayers();
      app.mapModule.points.addData(geojson);
      app.mapModule.map.fitBounds(app.mapModule.points.getBounds());
    }
  },

  queryModule: {
    init: function() {
      this.bindUIActions();
    },

    bindUIActions: function() {
      $("#csv-upload-input").change(function(evt) {
        var file = evt.target.files[0];
        Papa.parse(file, {
          skipEmptyLines: true,
          header: true,
          dynamicTyping: true,
          complete: function(results) {
            localStorage.setItem("fulcrum_queries", JSON.stringify(results.data));
            app.queryModule.fetchQueries();
            app.editor.getDoc().setValue($("#saved-queries-select option:first-child").val());
            alert("Queries imported successfully!");
          }
        });
      });

      $("#sqlModal").on("shown.bs.modal", function(e) {
        app.editor.refresh();
      });

      $(".search > input").keyup(function() {
        $("#feature-count").html($("#table").bootstrapTable("getData").length + " records");
      });

      $("#saved-queries-select").change(function() {
        app.editor.getDoc().setValue($("#saved-queries-select").val());
      });

      $(".org-picker-form").submit(function () {
        var username = $("#email").val();
        var password = $("#password").val();

        var data = {
          authorization: {
            organization_id: $("#context-select").val(),
            note: "Fulcrum Query Utility",
            timeout: 60 * 60 * 24
          }
        };

        $.ajax({
          type: "POST",
          url: "https://api.fulcrumapp.com/api/v2/authorizations",
          contentType: "application/json",
          data: JSON.stringify(data),
          dataType: "json",
          headers: {
            "Authorization": "Basic " + btoa(username + ":" + password)
          },
          statusCode: {
            401: function() {
              alert("Incorrect credentials, please try again.");
            }
          },
          success: function(data) {
            app.authModule.setupSession(data.authorization.token);
          }
        });
        return false;
      });

      $(".launch-query-btn").click(function() {
        $("#sqlModal").modal("show");
        return false;
      });

      $("#execute-query-btn").click(function() {
        app.queryModule.executeQuery(1, {});
        return false;
      });

      $("#save-query-btn").click(function() {
        if (app.editor.getDoc().getValue() !== "SELECT * FROM tables;") {
          app.queryModule.saveQuery();
        }
        return false;
      });

      $("#delete-query-btn").click(function() {
        if ($("#saved-queries-select option:selected").index() === 0) {
          alert("This query cannot be deleted!");
        } else {
          var ok = confirm("Are you sure you want to delete the following query: " + $("#saved-queries-select option:selected").text() + "?");
          if (ok === true) {
            app.queryModule.deleteQuery();
          }
          $("[data-toggle='dropdown']").parent().removeClass("open");
          return false;
        }
      });

      $("#export-queries-btn").click(function() {
        app.queryModule.exportQueries();
        $("[data-toggle='dropdown']").parent().removeClass("open");
        return false;
      });

      $("#import-queries-btn").click(function() {
        app.queryModule.importQueries();
        $("[data-toggle='dropdown']").parent().removeClass("open");
        return false;
      });

      $("#download-csv-btn").click(function() {
        var data = JSON.parse(JSON.stringify($("#table").bootstrapTable("getData")));
        for (var i = 0; i < data.length; i++) {
          for (var prop in data[i]) {
            if ($.type(data[i][prop]) === "object") {
              data[i][prop] = JSON.stringify(data[i][prop]);
            }
          }
        }
        var csv = Papa.unparse(data);
        var blob = new Blob([csv], {
          type: "text/csv"
        });
        saveAs(blob, "records.csv");
        $("[data-toggle='dropdown']").parent().removeClass("open");
        return false;
      });

      $("#download-json-btn").click(function() {
        var data = $("#table").bootstrapTable("getData");
        var json = JSON.stringify(data);
        var blob = new Blob([json], {
          type: "application/json"
        });
        saveAs(blob, "records.json");
        $("[data-toggle='dropdown']").parent().removeClass("open");
        return false;
      });

      $("#delete-records-btn").click(function() {
        var count = $("#table").bootstrapTable("getSelections").length;
        if (count > 0) {
          var response = confirm("Are you absolutely sure you want to permanently delete " + count + (count == 1 ? " record" : " records") + " from the Fulcrum database?\nThis cannot be undone!");
          if (response === true) {
            app.queryModule.deleteRecords();
          }
        }
        return false;
      });
    },

    fetchQueries: function() {
      if (localStorage.getItem("fulcrum_queries")) {
        var queries = JSON.parse(localStorage.getItem("fulcrum_queries"));
        queries = queries.filter(function(query) {
          return query.organization == $("#context-select option:selected").text();
        });
        queries = queries.sort(function(a, b) {
          return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1;
        });
        $("#saved-queries-select").empty();
        $("#saved-queries-select").append($("<option></option>").attr("value", "SELECT * FROM tables;").text("All tables"));
        $.each(queries, function(index, value) {
          $("#saved-queries-select").append($("<option></option>").attr("value", value.query).attr("id", value.id).text(value.name));
        });
      }
    },

    executeQuery: function(page, result) {
      var query = app.editor.getDoc().getValue();
      if (query.length > 0) {
        $("#loading").show();
        $.ajax({
          type: "POST",
          url: "https://api.fulcrumapp.com/api/v2/query?per_page=10000&page=" + page,
          data: JSON.stringify({
            "q": query,
            "format": "json"
          }),
          contentType: "application/json",
          headers: {
            "X-ApiToken": atob(sessionStorage.getItem("fulcrum_query_token"))
          },
          success: function (data, status, xhr) {            
            if (data.rows.length > 0) {
              if (result && result.rows) {
                data.rows.forEach(x => result.rows.push(x));
                if (data.rows.length == 10000) {
                  app.queryModule.executeQuery(page + 1, result);
                } else {
                  app.queryModule.parseQueryResponse(result);
                }
              } else {
                if (data.rows.length == 10000) {
                  app.queryModule.executeQuery(page + 1, data);
                } else {
                  app.queryModule.parseQueryResponse(data);
                }
              }
            } else if (result && result.rows) {
              app.queryModule.parseQueryResponse(result);
            }
          },
          error: function(jqXHR, textStatus, error) {
            app.currentFields = null;
            app.currentRows = null;
            $("#loading").hide();
            $("#error-alert").show();
            $("#error-message").html(jqXHR.responseText);
            $("#sqlModal").modal("show");
          },
          statusCode: {
            401: function() {
              alert("Session authorization expired");
              app.authModule.logout();
            }
          }
        });
      } else {
        alert("Query required!");
      }
    },

    saveQuery: function() {
      var name = prompt("Query name");
      if (name !== null) {
        var query = app.editor.getDoc().getValue();
        var queries;
        if (localStorage.getItem("fulcrum_queries")) {
          queries = JSON.parse(localStorage.getItem("fulcrum_queries"));
        } else {
          queries = [];
        }
        queries.push({
          "id": Date.now(),
          "organization": $("#context-select option:selected").text(),
          "name": name,
          "query": query
        });
        localStorage.setItem("fulcrum_queries", JSON.stringify(queries));
        app.queryModule.fetchQueries();
        $("#saved-queries-select").val(query);
      } else {
        alert("Query name is required!");
      }
    },

    deleteQuery: function() {
      var queries = JSON.parse(localStorage.getItem("fulcrum_queries"));
      queries = queries.filter(function(query) {
        return query.id != $("#saved-queries-select option:selected").attr("id");
      });
      localStorage.setItem("fulcrum_queries", JSON.stringify(queries));
      app.queryModule.fetchQueries();
      $("#saved-queries-select").val($("#saved-queries-select option:first-child").val());
      app.editor.getDoc().setValue($("#saved-queries-select option:first-child").val());
    },

    exportQueries: function() {
      var queries = JSON.parse(localStorage.getItem("fulcrum_queries"));
      queries = queries.sort(function(a, b) {
        return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1;
      });
      var csv = Papa.unparse(queries);
      var blob = new Blob([csv], {
        type: "text/csv;charset=utf-8"
      });
      saveAs(blob, "queries.csv");
    },

    importQueries: function() {
      var ok = confirm("Imported queries will delete/overwrite any existing queries. Are you sure you want to proceed?");
      if (ok === true) {
        $("#csv-upload-input").trigger("click");
      }
    },

    initialQuery: function() {
      var urlParams = {};
      if (location.search) {
        var parts = location.search.substring(1).split("&");
        for (var i = 0; i < parts.length; i++) {
          var nv = parts[i].split("=");
          if (!nv[0]) continue;
          urlParams[nv[0]] = nv[1] || true;
        }
      }
      if (urlParams.q) {
        app.editor.getDoc().setValue(decodeURI(urlParams.q));
        $("#sqlModal").modal("show");
        app.queryModule.executeQuery(1, {});
      } else {
        var savedQuery = sessionStorage.getItem("fulcrum_query_value");
        if (savedQuery) {
          app.editor.getDoc().setValue(savedQuery);
        } else {
          app.editor.getDoc().setValue("SELECT * FROM tables;");
          $("#saved-queries-select").val("SELECT * FROM tables;");
        }
        app.queryModule.executeQuery(1, {});
      }
    },

    urlFormatter: function(value, row, index) {
      if (value && value.length > 0) {
        value = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        if (value.includes("type=photo")) {
          return "<img src='" + value + "'/>";
        } else {
          return "<a href='" + value + "' target='_blank'>" + value + "</a>"; 
        }
      } else {
        return "";
      }
    },

    fulcrumFormatter: function(value, row, index) {
      if (value && value.length > 0) {
        value = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return "<a href='https://web.fulcrumapp.com/records/" + value + "' target='_blank'>" + value + "</a>";
      } else {
        return "";
      }
    },

    stringFormatter: function(value, row, index) {
      if (value && value.length > 0) {
        value = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return value;
      }
    },

    arrayFormatter: function (value, row, index) {
      if (value && value.length > 0) {
        if (value.find(element => element.includes('http')).length > 0){
          let values = value;
          value.forEach((value, index, values) => {
            values[index] = `<img src='${value}'/>`
          })
          return values
        } else {
          return value
        }
      }
    },

    geomFormatter: function(value, row, index) {
      if (value) {
        return JSON.stringify(value);
      } else {
        return "";
      }
    },

    parseQueryResponse: function(json) {
      var columns = [];

      app.currentFields = json.fields;
      app.currentRows = json.rows;
      app.currentGeometryColumn = null;

      json.fields.forEach(function(value, index) {
        if (value.type === "geometry" && app.currentGeometryColumn === null) {
          app.currentGeometryColumn = value.name;
          value.formatter = app.queryModule.geomFormatter;
        }

        else if (value.type == "string" || value.type == "unknown") {
          if (value.name == "_record_id" || value.name == "fulcrum_id") {
            value.formatter = app.queryModule.fulcrumFormatter;
            columns.push({
              field: "state",
              checkbox: true
            });
          } else {
            for (var i = 0; i < json.rows.length; i++) for (var i = 0; i < json.rows.length; i++) {
              if (Array.isArray(json.rows[i][value.name])) {
                value.formatter = app.queryModule.arrayFormatter;
              } 
              else if (json.rows[i][value.name] && JSON.stringify(json.rows[i][value.name]).indexOf("http") === 1) {
                value.formatter = app.queryModule.urlFormatter;
                if (JSON.stringify(json.rows[i][value.name]).includes("type=photo")) {
                  value.width = 250;
                }
              } else {
                value.formatter = app.queryModule.stringFormatter;
              }
            }
          }
        }

        columns.push({
          field: value.name,
          title: value.name,
          align: "left",
          valign: "middle",
          sortable: true,
          width: value.width ? value.width : "",
          formatter: value.formatter ? value.formatter : ""
        });
      });

      $("#table").bootstrapTable();
      $("#table").bootstrapTable("refreshOptions", {
        data: json.rows,
        virtualScroll: true,
        pagination: true,
        pageSize: 250,
        pageList: [100, 250, 500, 1000],
        paginationUseIntermediate: true,
        columns: columns,
        undefinedText: "",
        cache: false,
        height: "fit",
        toolbar: "#toolbar",
        showColumns: true,
        showToggle: true,
        search: true,
        trimOnSearch: false,
        striped: false,
        onSearch: function(e) {
          $("#feature-count").html($("#table").bootstrapTable("getData").length + " records");
        },
        onCheck: function(e) {
          $("#delete-records-btn").show();
          $("#delete-count").html($("#table").bootstrapTable("getSelections").length);
        },
        onCheckAll: function(e) {
          $("#delete-records-btn").show();
          $("#delete-count").html($("#table").bootstrapTable("getSelections").length);
        },
        onUncheck: function(e) {
          if ($("#table").bootstrapTable("getSelections").length === 0) {
            $("#delete-records-btn").hide();
          }
          $("#delete-count").html($("#table").bootstrapTable("getSelections").length);
        },
        onUncheckAll: function(e) {
          $("#delete-records-btn").hide();
        }
      });
      $("#table").bootstrapTable("resetView", {
        height: $(window).height() - 70
      });
      $("#feature-count").html($("#table").bootstrapTable("getData").length + " records");
      $("#toolbar").show();
      //$("#sqlModal").modal("hide");
      $("#error-alert").hide();
      $("#loading").hide();
    },

    deleteRecords: function() {
      var selections = $("#table").bootstrapTable("getSelections");
      var id = null, field = null;
      var deleted = 0;
      var notfound = [];
      var unauthorized = [];
      $.each(selections, function(index, value) {
        if (value._record_id) {
          field = "_record_id";
          id = value._record_id;
        } else if (value.fulcrum_id) {
          field = "fulcrum_id";
          id = value._record_id;
        }
        $.ajax({
          async: false,
          url: "https://api.fulcrumapp.com/api/v2/records/" + id + ".json",
          type: "DELETE",
          contentType: "application/json",
          dataType: "json",
          headers: {
            "X-ApiToken": atob(sessionStorage.getItem("fulcrum_query_token"))
          },
          statusCode: {
            401: function() {
              unauthorized.push(id);
            },
            404: function() {
              notfound.push(id);
            },
            204: function() {
              $("#table").bootstrapTable("remove", {
                field: field,
                values: [id]
              });
              $("#feature-count").html($("#table").bootstrapTable("getData").length + " records");
              $("#delete-records-btn").hide();
              deleted++;
            }
          }
        });
      });
      if (unauthorized.length > 0) {
        alert("You were unauthorized to delete the following records: " + unauthorized.join("\n"));
      }
      if (notfound.length > 0) {
        alert("The following records were not found in your account: " + notfound.join("\n"));
      }
      if (deleted > 0) {
        alert(deleted + (deleted == 1 ? " record" : " records") + " deleted!");
      }
    }
  }

};
