from django.urls import path

from . import datanova_views

app_name = 'datanova'

urlpatterns = [
    path('', datanova_views.dashboard, name='dashboard'),
    path('login/', datanova_views.sign_in, name='login'),
    path('signup/', datanova_views.sign_up, name='signup'),
    path('logout/', datanova_views.sign_out, name='logout'),
    path('projects/<int:project_id>/', datanova_views.project_detail, name='project-detail'),
    path('api/projects/', datanova_views.project_collection, name='project-collection'),
    path('api/projects/<int:project_id>/', datanova_views.project_item, name='project-item'),
    path(
        'api/projects/<int:project_id>/dataset/',
        datanova_views.dataset_upload,
        name='dataset-upload',
    ),
    path(
        'api/projects/<int:project_id>/ask/',
        datanova_views.dataset_question,
        name='dataset-question',
    ),
    path(
        'api/milestones/<int:milestone_id>/',
        datanova_views.milestone_update,
        name='milestone-update',
    ),
]
